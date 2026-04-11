const libx=require("./src/index.js")
var variable="value"
var mydict={"key":"value","key2":[1,2,3],"key3":{"subkey":"subvalue"}}
var mylist=[1,2,3,"four",{"key":"value"}]
var myflag=false
function myfunction(){
    myflag=!myflag
    return myflag
}
function printout(x){
    console.log(x)
}
module.exports={variable,mydict,mylist,myflag,myfunction,JSON}
if(!libx.exportx()){
    console.log("This file is not being importx'ed")
}else{
    console.log("Hello from JS!")
}
