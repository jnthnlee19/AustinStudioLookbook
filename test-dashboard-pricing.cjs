const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/netlify/functions/list-lookbooks.js', 'utf8')
  .replace(/^import .*;\n/gm, '').replace('export default async function handler', 'async function handler');
const option = (id, price) => [id, null, 'Sample option',,,,,,,,,,,price];
const rows = [...Array(14).fill([]), ['General > Kitchen'], option('100', 100), option('101', 80),
  ['MO Flooring > Tile'], option('200', 900), option('2018056', 1000)];
const records = new Map();
const store = { list: async () => ({ blobs: [...records.keys()].filter(key => key.startsWith('lookbooks/')).map(key => ({key})) }),
  get: async key => records.get(key) || null };
const ctx = vm.createContext({ Response, console, getStore: () => store,
  XLSX: { read: () => ({Sheets:{Sheet2:{}}}), utils:{sheet_to_json:()=>rows} } });
vm.runInContext(source + '\nthis.calculate=calculateSelectedTotal;this.handler=handler;', ctx);
const book = selections => ({id:'test',name:'Sample',workbook:'fixture',selections});
assert.equal(ctx.calculate(book([{option:'100',selected:true,qty:3}])), 300);
assert.equal(ctx.calculate(book([{option:'100',qty:3}])), 300, 'legacy selection');
assert.equal(ctx.calculate(book([{option:'100',selected:false,bookmarked:true,qty:3}])), 0, 'bookmarks excluded');
assert.equal(ctx.calculate({...book([{option:'100',selected:true,qty:3}]), selectedTotal:9999,
  pricing:{options:{100:{amount:125.5}}}}), 376.5, 'fresh consultant price beats stale total');
assert.equal(ctx.calculate({...book([{option:'100',qty:3}]),pricing:{options:{100:{amount:0}}}}), 0, 'zero override');
assert.equal(ctx.calculate({...book([{option:'100',qty:2}]),priceOverrides:{100:'$120.25'}}),240.5, 'legacy override');
assert.equal(ctx.calculate(book([{option:'200',qty:2},{option:'2018056',qty:1}])),0, 'unpriced flooring/included');
assert.equal(ctx.calculate({...book([{option:'200',qty:2},{option:'2018056',qty:1}]),
  pricing:{options:{200:{amount:500},2018056:{amount:25}}}}),1025, 'consultant flooring overrides');
assert.equal(ctx.calculate({...book([{option:'100',qty:1}]),pricing:{options:{100:{amount:NaN}}}}),100);
assert.equal(ctx.calculate(book([])),0);
records.set('lookbooks/test',{...book([{option:'100',qty:3}]),createdAt:'2026-11-01T10:00:00Z',updatedAt:'2026-11-02T10:00:00Z'});
records.set('pricing/test',{updatedAt:'2026-11-05T10:00:00Z',options:{100:{amount:125.5}}});
(async()=>{
  const response=await ctx.handler(new Request('https://example.test/.netlify/functions/list-lookbooks'));
  const data=await response.json();
  assert.equal(response.status,200);
  assert.equal(data.lookbooks[0].selectedTotal,376.5);
  assert.equal(data.lookbooks[0].updatedAt,'2026-11-05T10:00:00Z');
  records.get('lookbooks/test').updatedAt='2026-11-06T10:00:00Z';
  const newer=await (await ctx.handler(new Request('https://example.test/'))).json();
  assert.equal(newer.lookbooks[0].updatedAt,'2026-11-06T10:00:00Z');
  assert.equal((await ctx.handler(new Request('https://example.test/',{method:'POST'}))).status,405);
  console.log('PASS: dashboard consultant/legacy prices, quantities, bookmarks, flooring, stale totals, price timestamps and list endpoint.');
})().catch(error=>{console.error(error);process.exitCode=1;});
