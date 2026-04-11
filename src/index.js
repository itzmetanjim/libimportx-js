/*SPDX:GPL-3.0-or-later*/
const net=require("net")
var handleMap={}
var rHandleMap=new Map()
var handleCounter=0
function strip(str,char){
    const esc = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`^[${esc}]+|[${esc}]+$`, 'g')
    return str.replace(pattern, '')
}
function parseIdentifier(a){
    const pattern=/\[(?:".*?"|\'.*?\'|[^\]])*?\]|[^.\[\]]+/g
    const uparts=a.match(pattern) || []
    const parts=uparts.map(i=>{
        return strip(i,".")
    })
    return parts
}
function decideNSP(nsp){
    if(nsp===null){
        try{
            nsp=require.main.exports
        }catch(e){
            console.warn(`Could not access main exports, using globalThis as \
the namespace. Error was: ${e}`)
            nsp=globalThis
        }
    }
    return nsp
}
function resolveIdentifier(a,nsp=null,parent=false){
    nsp=decideNSP(nsp)
    const parts=parseIdentifier(a)
    let current=nsp
    let last,sub,idx,ssub
    if(parent){
        last=parts.pop()
    }
    for(let i of parts){
        if(current===undefined||current===null){
            throw new TypeError(`Cannot read property ${i} of ${current} in \
${a}`)
        }
        if(i.startsWith('["') || i.startsWith("['") ){
            if(!(i.endsWith('"]') || i.endsWith("']"))){
                throw new SyntaxError(`Unmatched bracket or quote in ${a}: \
${i}`)
            }
            i=i.slice(2,-2)
            ssub='"'+i+'"'
            sub=JSON.parse(ssub)
        }else if (i.startsWith("[")){
            if(!i.endsWith("]")){
                throw new SyntaxError(`Unmatched bracket in ${a}: ${i}`)
            }
            i=i.slice(1,-1)
            idx=parseInt(i)
            if(isNaN(idx)){
                throw new SyntaxError(`Invalid index in ${a}: ${i}. You may \
have meant to put quotes.`)
            }
            sub=idx
        }else{
            sub=i
        }
        if (typeof sub ==="string" &&
            (sub.startsWith("function ")||sub.startsWith("opaque "))){
            if(!(sub in handleMap)){
                throw new ReferenceError(`Handle ${sub} not found in ${a}`)
            }
            current=handleMap[sub]
        }else{
            current=current[sub]
        }
    }
    if(current===undefined){
        throw new ReferenceError(`${a} is not defined`)
    }
    if(parent){
        return [current,last]
    }
    //else:
    return current
}
function tname(x){
    if(x===null){return "null"}
    if(x===undefined){return "undefined"}
    if(x[Symbol.toStringTag]){return x[Symbol.toStringTag]}
    if(x.constructor && x.constructor.name){return x.constructor.name}
    /*if none of the above*/ return typeof x
}
function monoencode(key,x){
    if(typeof x !== "object" && typeof x !== 'function'){return x}
    if(x===null){return x}
    if(Array.isArray(x)){return x}
    if(x.constructor==="Object" && !x[Symbol.toStringTag]){return x}

    let typ,ans,handle
    if(typeof x==="function"){typ="function"}
    else{typ="opaque"}
    ans={"__libimportx_foreign_type__":typ}
    if(typ==="opaque"){
        ans.type=tname(x)
    }
    if(rHandleMap.has(x)){handle=rHandleMap.get(x)}
    else{
        handle=typ+" "+handleCounter.toString(16)
        handleMap[handle]=x
        rHandleMap.set(x,handle)
        handleCounter++
    }
    ans.handle=handle
    return ans
}
function convert(x){
    return JSON.stringify(x,monoencode)
}

function deconvert(x){
    if(typeof x !== "object" || x===null){
        return x
    }
    if(Array.isArray(x)){
        //recursion!
        return x.map(deconvert)
    }
    //x is a dictionary
    if("__libimportx_foreign_type__" in x){
        if(handleMap.has(x.handle)){
            return handleMap.get(x.handle)
        }else{
            return x
        }
    }
    let ans={}
    for(let i in x){
        ans[i]=deconvert(x[i])
    }
    return ans
}
function setIdentifier(ide,v,nsp=null){
    nsp=decideNSP(nsp)
    let [p,child]=resolveIdentifier(ide,nsp,true) //no idea how to do kwargs js
    if(child.startsWith('["') || child.startsWith("['")){
        if(!(child.endsWith('"]') || child.endsWith("']"))){
            throw new SyntaxError(`Unmatched bracket or quote in ${ide}: \
${child}`)
        }
        child=child.slice(2,-2)
        child=JSON.parse('"'+child+'"')
        p[child]=v
    }else if (child.startsWith("[")){
        if(!child.endsWith("]"))
        {
            throw new SyntaxError(`Unmatched bracket in ${ide}: ${child}`)
        }
        child=child.slice(1,-1)
        idx=parseInt(child)
        if(isNaN(idx)){
            throw new SyntaxError(`Invalid index in ${ide}: ${child}. You may \
have meant to put quotes.`)
        }
        p[idx]=v
    }else{
        p[child]=v
    }
}

function cError(e){
    //return `-{"type":"${e.name}","message":"${e.message}"}\n`
    let edat={"type":e.name,"message":e.stack || e.message}
    return "-"+JSON.stringify(edat)+"\n"
}

function exportx(root=null){
    if(process.env.LIBIMPORTX!=="true"){
        return false
    }
    root=decideNSP(root) //glad i wrote that
    let lihost=process.env.LIBIMPORTX_HOST
    let litoken=process.env.LIBIMPORTX_TOKEN
    if(!lihost||!litoken){
        throw new Error("LIBIMPORTX_HOST LIBIMPORTX_TOKEN env vars not set")
    }
    var hasConnected=false
    const client=net.createConnection(lihost)
    let lo="" //leftover
    //on the connect event
    client.on("connect",()=>{
        client.write(litoken+"\n")
    })
    client.on("end",()=>{
        process.exit(0)
    })
    client.on("data",(chunk)=>{
        lo+=chunk.toString()
        while(lo.includes("\n")){
            let idx=lo.indexOf("\n")
            let line=lo.slice(0,idx)
            lo=lo.slice(idx+1)
            if(!hasConnected){
                if(line!="+"){
                    throw new Error("Invalid token (this should never happen)")
                }
                //else:
                hasConnected=true
                continue
            }
            //else:
            let data=JSON.parse(line)
            let dtype=data.type ?? ""
            if(dtype===""){
                client.write(`-{"type":"InvalidRequest","message":"Missing field \
'type'"}\n`)
                continue
            }else if(dtype==="read"){
                let ide=data.identifier ?? ""
                if(ide===""){
                    client.write(`-{"type":"InvalidRequest","message":"Missing \
field 'identifier'"}\n`)
                    continue
                }else{
                    try{
                        let uvalue=resolveIdentifier(ide,root)
                        let value=convert(uvalue)
                        client.write("+"+value+"\n")
                    }catch(e){
                        client.write(cError(e))
                    }
                }
            }else if(dtype==="call"){
                let ide=data.identifier ??""
                if(ide===""){
                    client.write(`-{"type":"InvalidRequest","message":"Missing \
field 'identifier'"}\n`)
                }
                else{
                    let args=data.args??[]
                    let kwargs=data.kwargs??{}
                    try{
                        let func=resolveIdentifier(ide,root)
                        let uvalue=func(...deconvert(args),deconvert(kwargs))
                        let value=convert(uvalue)
                        client.write("+"+value+"\n")
                    }catch(e){
                        client.write(cError(e))
                    }
                }
            }else if(dtype==="set"){
                let ide=data.identifier??""
                if(ide===""){
                    client.write(`-{"type":"InvalidRequest","message":"Missing \
field 'identifier'"}\n`)
                }else{
                    let value=data.value
                    try{
                        setIdentifier(ide,deconvert(value),root)
                        client.write("+\"OK\"\n")
                    }catch(e){
                        client.write(cError(e))
                    }
                }
            }
        }})
    client.on("error",(e)=>{
        console.error("Connection error:",e)
        process.exit(1)
    })
    return true
}
module.exports = {
    exportx,
    version: "1.0.0"
};

