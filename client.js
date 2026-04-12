const libx=require("./src/index.js")
var variable="value"
var mydict={"key":"value","key2":[1,2,3],"key3":{"subkey":"subvalue"}}
var mylist=[1,2,3,"four",{"key":"value"}]
var myflag=[false]
function myfunction(){
    myflag[0]=!myflag[0]
    return myflag[0]
}
function printout(x){
    console.log(x)
}
function add(a,b){
    return a+b
}
module.exports={variable,mydict,mylist,myflag,myfunction,JSON,add}
if(!libx.exportx()){
    console.log("This file is not being importx'ed")
}else{
    console.log("Hello from JS!")
}
