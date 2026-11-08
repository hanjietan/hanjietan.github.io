/* LOCAL fixtures through the actual adapter; never bundled or published. */
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const actual=JSON.parse(fs.readFileSync(path.join(__dirname,"fixtures/hepo-20261108.json"),"utf8"));
const now=Date.parse("2026-11-08T04:10:12Z")/1000;
const environment={location:{protocol:"about:"},Date,JSON,isFinite,XMLHttpRequest:function(){throw Error("offline helper must not access network");}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,"provider.js"),"utf8"),environment);
function normalize(raw){return environment.OpenMeteoProvider.normalize(JSON.parse(JSON.stringify(raw)),now);}
const raw=JSON.parse(JSON.stringify(actual)),full=normalize(raw),partialRaw=JSON.parse(JSON.stringify(raw));
partialRaw.daily.temperature_2m_min[1]=null;partialRaw.daily.precipitation_sum[2]=null;partialRaw.daily.weather_code[2]=null;
const partial=normalize(partialRaw);
module.exports={synthetic_test_only:true,now,raw,partialRaw,full,partial,normalize};
