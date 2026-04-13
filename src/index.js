/*SPDX:GPL-3.0-or-later*/
const removeprefix = (str, prefix) =>
    str.startsWith(prefix) ? str.slice(prefix.length) : str;
const EXTENSION_TABLE={
    ".py":"python3 $IN",
    ".js":"node $IN",
    ".rb":"ruby $IN",
    ".lua":"lua $IN",
    ".java":"java $IN",
    ".c":"gcc $IN -o $OUT",
    ".cpp":"g++ $IN -o $OUT",
    ".rs":"rustc $IN -o $OUT",
    ".go":"go run $IN",
    ".sh":"bash $IN",
    ".ps1":"pwsh -File $IN",
    ".php":"php $IN",
    ".pl":"perl $IN",
    ".r":"Rscript $IN"
}
const net=require("net")
const {spawn} = require("child_process")
const fs=require("fs")
const crypto=require("crypto")//for generating random tokens
const os=require("os")
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
    // if(x.constructor==="Object" && !x[Symbol.toStringTag]){return x}
    if (Object.prototype.toString.call(x) === "[object Object]") {
        return x;
    }
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
    let ans=JSON.stringify(x,monoencode)
    if(ans==="undefined"){//the string
        return "null"
    }
    return ans
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
        if(x.handle in handleMap){
            return handleMap[x.handle]
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
            if(!line.trim()){continue}
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

function make_req(sock,type,identifier,args=[],kwargs={},value=null){
    return new Promise((resolve,reject)=>{
        sock.reqQueue.push({resolve,reject,type,identifier,args,kwargs,value})
        sock.write(JSON.stringify({type,identifier:identifier,args,kwargs,value}
            ,monoencode_host)+"\n")
    })
}
class Kwargs{
    //to allow calling with kwargs in js since js has no kwargs
    constructor(kwargs){
        this.kwargs=kwargs
    }
}
function createProxy(sock,identifier,foreign_type=null,type_name=null){
    const callable= function(...args){
        let kwargs={}
        let args2=[]
        for(let i=0;i<args.length;i++){
            if(args[i] instanceof Kwargs){
                if(Object.keys(kwargs).length>0){
                    throw new Error("Multiple Kwargs objects not allowed")
                }
                kwargs=args[i].kwargs

            }else{
                args2.push(args[i])
            }
        }
        return make_req(sock,"call",identifier,args2,kwargs,null)
    }
    callable.then=function(resolve,reject){
        make_req(sock,"read",identifier).then(resolve,reject)
    } //cursed JS feature
    const ans=new Proxy(callable,
        {
            get: (target,prop)=>{
                if(prop==="then"&&(!identifier||foreign_type)){
                    return undefined //its not a promise
                }
                if(["then","catch","finally"].includes(prop)
                    || typeof prop==="symbol"){
                    return target[prop]
                }
                if(prop === "__libimportx_handle"){return identifier}
                if(prop === "__libimportx_foreign_type__"){
                    return foreign_type||"opaque"
                }
                if(prop==="__libimportx_type"){return type_name}
                const next=identifier? `${identifier}[${JSON.stringify(prop,
                    monoencode_host)}]`:prop
                return createProxy(sock,next)
            },
            set: (target,prop,value)=>{
                const next=identifier?`${identifier}[${JSON.stringify(prop,
                    monoencode_host)}]`:prop
                make_req(sock,"set",next,[],{},value).catch(console.error)
                return true
            }
        })
    return ans
}
function monoencode_host(key,x){
    if(x&&x.__libimportx_foreign_type__!==undefined){
        return {
            "__libimportx_foreign_type__":x.__libimportx_foreign_type__||"opaque",
            "handle":x.__libimportx_handle,
            "type":x.__libimportx_type||""}
    }
    return monoencode(key,x)
}
function deconvert_host(x,sock){
    if(typeof x!=="object"||x===null){
        return x
    }
    if(x&&x.__libimportx_foreign_type__){
        return createProxy(sock,x.handle,x.__libimportx_foreign_type__
            ,x.type??"")
    }
    //otherwise, recurse through the object
    if(Array.isArray(x)){
        return x.map(i=>deconvert_host(i,sock))
    }
    let ans={}
    for(let i in x){
        ans[i]=deconvert_host(x[i],sock)
    }
    return ans
}
function squo(a){
    if(typeof a!=="string"){
        a=String(a)
    }
    if(process.platform==="win32"){
        return '"' + a.replace(/"/g, '""') + '"'
    }else{
        return "'" + a.replace(/'/g, "'\\''") + "'"
    }
}
function importx(filepath,cmd=null){
    return new Promise((resolve,reject)=>{
        const tmpdir=fs.mkdtempSync(os.tmpdir() + "/libx_")
        const token=crypto.randomUUID()
        //file exec logic
        let command=null //unreplaced command
        let ext=filepath.split(".").slice(-1)[0]
        if(cmd){command=cmd}
        else{
            let first=""
            try{
                first=fs.readFileSync(filepath,{encoding:"utf-8",flag:"r"}).split(`\
\n`)[0].trim()
                if(first.startsWith("#!")||first.startsWith("//!")){
                    command=removeprefix(removeprefix(first,"#!"),"//!").trim()
                }else if(first.startsWith("##!")||first.startsWith("///!")){
                    command=removeprefix(removeprefix(first,"##!"),"///!").trim()
                }else{throw new Error("Skipping to catch")}
            }catch(e){
                //either file cant be read or no shebang, so try env then table
                command=process.env[`LIBIMPORTX_DEFAULT_CMD_${ext.toUpperCase()}\
`]||EXTENSION_TABLE["."+ext]||``
            }
        }
        //at this point, command is guranteed to be set
        if(!command){throw new Error("Could not determine command to run file. \
Please set the env variable LIBIMPORTX_DEFAULT_CMD_"+ext.toUpperCase())}
        const outpath=tmpdir+"/out.bin"
        const sockpath=tmpdir+"/libx.sock"
        if(command.split("$OUT").length===2){
            command+=" && $OUT"
        }
        command=command.replaceAll("$IN",squo(filepath))
            .replaceAll("$OUT",squo(outpath))
        let env=process.env
        let envi={...env,
            LIBIMPORTX:"true",
            LIBIMPORTX_HOST:sockpath,
            LIBIMPORTX_TOKEN:token}
        const server=net.createServer()
        server.maxConnections=1
        server.on("connection",(sock)=>{
            let lo=""
            sock.reqQueue=[]
            sock.authdone=false
            sock.on("data",(chunk)=>{
                let rdata=chunk.toString()
                lo+=rdata
                while(lo.includes("\n")){
                    let idx=lo.indexOf("\n")
                    let line=lo.slice(0,idx)
                    lo=lo.slice(idx+1)
                    if(!line.trim()){continue}
                    if(!sock.authdone){
                        if(line!==token){
                            //intruder!
                            sock.write("-\n")
                            sock.end()
                            throw new Error("Invalid token (this should never\
 happen)")
                        }
                        sock.write("+\n")
                        sock.authdone=true
                        resolve(createProxy(sock,""))
                        continue
                    }
                    let prefix=line[0]
                    let data=JSON.parse(line.slice(1))
                    //resolve/reject the reqQueue
                    if(sock.reqQueue.length!==0){
                        let req=sock.reqQueue.shift()
                        if(prefix==="+"){
                            req.resolve(deconvert_host(data,sock))
                        }else{
                            req.reject(new Error(`${data.type}: ${data.message}`))
                        }
                    }else{
                        console.warn("Recieved response but there was no\
 request. ",data)
                    }
                }
            })
        })
        server.on("error",reject)
        server.listen(sockpath)
        const child=spawn(command,{shell:true,
            env:envi,
            stdio:"inherit"
        })
        child.on("error",reject)
        child.on("exit",(code)=>{
            if(code!==0&&!server.listening){
                reject(new Error(`Process exited with code ${code} before\
connection was established. Command was: ${command}`))
            }
        })
    })
}

module.exports = {
    exportx,
    Kwargs,
    importx,
    version: "1.0.0"
};

