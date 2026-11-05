const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const source = fs.readFileSync(__dirname+'/netlify/functions/consultant-pricing.js','utf8')
  .replace(/^import .*;\n/gm,'').replace('export default async function handler','async function handler').replace('export const config','const config');
const id='12345678-1234-4234-8234-123456789abc';
const record={workbook:'fixture',selections:[{option:'100',qty:3}],priceOverrides:{}};
let pricing=null, version=0, forceConflict=false;
const store={
  get: async key => key.startsWith('lookbooks/') ? record : pricing,
  getWithMetadata: async () => pricing ? {data:structuredClone(pricing),etag:String(version)} : null,
  setJSON: async (key,data,options) => {
    if(forceConflict || (options.onlyIfMatch && options.onlyIfMatch!==String(version))) return {modified:false};
    pricing=structuredClone(data);version++;return {modified:true,etag:String(version)};
  }
};
const context=vm.createContext({...crypto,Buffer,Response,URL,process:{env:{PROTECTED_PAGE_PASSWORD:'test-only-password'}},getStore:()=>store,
  XLSX:{read:()=>({Sheets:{Sheet2:{}}}),utils:{sheet_to_json:()=>[...Array(14).fill([]),['General'],['100',null,'Test option',,,,,,,,,,,100],['MO Flooring'],['200',null,'Flooring',,,,,,,,,,,0]]}}});
vm.runInContext(source+'\nthis.handler=handler;',context);
const call=async (payload,cookie='',origin='https://test.example') => {
  const response=await context.handler(new Request('https://test.example/.netlify/functions/consultant-pricing',{method:'POST',headers:{origin,cookie,'Content-Type':'application/json'},body:JSON.stringify({id,...payload})}));
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
};
(async()=>{
  assert.equal((await call({action:'unlock',password:'wrong'})).status,401);
  assert.equal((await call({action:'save',option:'100',amount:120,revision:0})).status,401);
  assert.equal((await call({action:'unlock',password:'test-only-password'},'','https://other.example')).status,403);
  const auth=await call({action:'unlock',password:'test-only-password'});
  assert.equal(auth.status,200);assert.match(auth.cookie,/HttpOnly; Secure; SameSite=Strict/);
  const cookie=auth.cookie.split(';')[0];
  assert.equal((await call({action:'save',option:'100',amount:-1,revision:0},cookie)).status,400);
  assert.equal((await call({action:'save',option:'100',amount:1.234,revision:0},cookie)).status,400);
  assert.equal((await call({action:'save',option:'missing',amount:10,revision:0},cookie)).status,400);
  const saved=await call({action:'save',option:'100',amount:125.50,revision:0},cookie);
  assert.equal(saved.status,200);assert.equal(pricing.options['100'].originalPrice,'$100.00');
  assert.equal(pricing.options['100'].amount,125.5);assert.equal(pricing.revision,1);
  assert.ok(Date.parse(pricing.options['100'].updatedAt));assert.equal(record.selections[0].qty,3);
  assert.equal((await call({action:'save',option:'100',amount:150,revision:0},cookie)).status,409);
  await call({action:'save',option:'100',amount:150,revision:1},cookie);
  assert.equal(pricing.options['100'].originalPrice,'$100.00');assert.equal(pricing.options['100'].history.length,2);
  assert.equal(pricing.options['100'].history[1].previousPrice,'$125.50');
  forceConflict=true;assert.equal((await call({action:'save',option:'100',amount:160,revision:2},cookie)).status,409);forceConflict=false;
  record.active=false;assert.equal((await call({action:'save',option:'100',amount:160,revision:2},cookie)).status,403);record.active=true;
  await call({action:'save',option:'200',amount:300,revision:2},cookie);
  assert.equal(pricing.options['200'].originalPrice,'Pricing Available at Selection Appointment');
  assert.equal((await call({id:'22345678-1234-4234-8234-123456789abc',action:'save',option:'100',amount:160,revision:3},cookie)).status,401);
  const html=fs.readFileSync(__dirname+'/customer.html','utf8');
  const inline=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];new vm.Script(inline);
  const totalSource=inline.slice(inline.indexOf('    function updateTotal()'),inline.indexOf('    function toggleAllSections()'));
  const totalBar={};const maybeBar={};
  const card=(price,qty,selected,maybe,mo=false)=>({dataset:{moFlooring:mo?'1':'0',consultantPriced:mo?'1':'0'},classList:{contains:()=>maybe},querySelector:s=>s==='.option-checkbox'?{checked:selected,dataset:{price}}:{value:qty}});
  const ui=vm.createContext({document:{querySelectorAll:()=>[card('125.50',3,true,false),card('300',2,true,true,true),card('90',1,false,true)],getElementById:id=>id==='total-bar'?totalBar:maybeBar}});
  vm.runInContext(totalSource+'\nupdateTotal();',ui);
  assert.equal(totalBar.textContent,'$976.50');assert.match(maybeBar.textContent,/690\.00/);
  console.log('PASS: password, authorization scope, same-origin, validation, server timestamps, original price/history, persistence, conflicts, disabled lookbooks, MO flooring, quantities, quote/bookmark totals and inline syntax.');
})().catch(error=>{console.error(error);process.exitCode=1;});
