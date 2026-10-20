'use strict';
const OnlineData=(()=>{
  let data,orders,ready;const storageKey='yuanpei-olist-scenarios-v1';
  const orderFields=['order_id','order_date','zone_id','order_status','item_value','freight_value','delivery_days','is_late','has_items'];
  async function load(){
    if(!ready)ready=Promise.all(['bootstrap','orders'].map(async name=>{const r=await fetch('./data/'+name+'.json');if(!r.ok)throw Error('公开数据暂时无法读取，请稍后重试');return r.json();})).then(([bootstrap,raw])=>{
      data=bootstrap;orders=raw.rows.map(row=>Object.fromEntries(raw.fields.map((key,i)=>[key,row[i]])));return data;
    }).catch(e=>{ready=null;throw e;});return ready;
  }
  function saved(){try{const rows=JSON.parse(localStorage.getItem(storageKey)||'[]');return Array.isArray(rows)?rows.filter(s=>s&&typeof s.id==='string'&&s.scenario&&Array.isArray(s.scenario.sites)&&s.scenario.metrics).slice(0,30):[];}catch{return [];}}
  function validDate(value){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
  function filtered(q){
    const start=q.get('start')||'2018-07-02',end=q.get('end')||'2018-07-29',zone=Number(q.get('zone')??-1),late=Number(q.get('late')??0);
    if(!validDate(start)||!validDate(end)||start<data.config.start||end>=data.config.end_exclusive||start>end)throw Error('日期超出历史数据范围或起止顺序有误');
    if(!Number.isInteger(zone)||zone< -1||zone>=data.config.zones||![0,1].includes(late))throw Error('区域或筛选参数无效');
    return {rows:orders.filter(r=>r.order_date>=start&&r.order_date<=end&&(zone<0||r.zone_id===zone)&&(!late||r.is_late===1)),period:{start,end,zone}};
  }
  function aggregate(rows){
    let days=0,daysN=0;const a={orders:rows.length,item_value:0,freight_value:0,delivered:0,late:0,no_items:rows.length?0:null};
    for(const r of rows){a.item_value+=r.item_value??0;a.freight_value+=r.freight_value??0;a.delivered+=r.delivery_observed;a.late+=r.is_late??0;a.no_items+=1-r.has_items;if(r.delivery_days!==null){days+=r.delivery_days;daysN++;}}
    a.delivery_days=daysN?days/daysN:null;a.late_rate=a.delivered?a.late/a.delivered:null;return a;
  }
  function overview(q){
    const {rows,period}=filtered(q),groups=new Map(),weeks=new Map();
    for(const r of rows){if(!groups.has(r.zone_id))groups.set(r.zone_id,[]);groups.get(r.zone_id).push(r);if(!weeks.has(r.week_start))weeks.set(r.week_start,[]);weeks.get(r.week_start).push(r);}
    const zones=[...groups].map(([zone_id,rs])=>({zone_id,...aggregate(rs)})).sort((a,b)=>b.orders-a.orders||a.zone_id-b.zone_id);
    const trend=[...weeks].sort(([a],[b])=>a.localeCompare(b)).map(([week_start,rs])=>({week_start,orders:rs.length,late:rs.some(r=>r.is_late!==null)?rs.reduce((s,r)=>s+(r.is_late||0),0):null}));
    return {kpis:aggregate(rows),zones,trend,period,issues:zones.filter(r=>r.delivered>=20).sort((a,b)=>b.late_rate-a.late_rate||b.late-a.late).slice(0,5),issue_rule:'有效送达订单至少20单，按逾期率降序；用于人工排查'};
  }
  function orderRows(q,all=false){
    const rs=filtered(q).rows,page=Math.max(1,Number(q.get('page')||1));if(!Number.isInteger(page))throw Error('页码无效');
    const selected=all?rs:rs.slice((page-1)*20,page*20);return {rows:selected.map(r=>Object.fromEntries(orderFields.map(k=>[k,r[k]]))),total:rs.length,page,page_size:20};
  }
  function optimize(payload){return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./optimizer.js', document.baseURI)),timer=setTimeout(()=>{worker.terminate();reject(Error('计算用时过长，请减少网点数量后重试'));},120000);
    function finish(){clearTimeout(timer);worker.terminate();}
    worker.onmessage=event=>{finish();event.data.ok?resolve(event.data.plan):reject(Error(event.data.error));};
    worker.onerror=()=>{finish();reject(Error('规划计算未能完成，请使用新版浏览器重试'));};worker.postMessage(payload);
  });}
  async function saveScenario(p){
    const name=String(p.name??'新方案').trim(),origin=p.origin,k=Number(p.k),priority=Number(p.priority_zone),factor=Number(p.factor);
    if(!name||name.length>80)throw Error('方案名限1至80个字符');
    if(!['2018-07-02','2018-07-30'].includes(origin))throw Error('回放窗口无效');
    if(!Number.isInteger(k)||!data.config.site_counts.includes(k)||!Number.isInteger(priority)||priority< -1||priority>=data.zones.length||!Number.isFinite(factor)||factor<1||factor>3)throw Error('预算或区域权重超出范围');
    const weights=data.weights.filter(r=>r.origin===origin).sort((a,b)=>a.zone_id-b.zone_id).map(r=>r.forecast_demand);if(priority>=0)weights[priority]*=factor;
    const end=new Date(Date.parse(origin)+28*86400000).toISOString().slice(0,10);
    const points=orders.filter(r=>r.order_date>=origin&&r.order_date<end).map(r=>[r.lat,r.lon]);
    const scenario={...await optimize({zones:data.zones,weights,k,points}),origin,end_exclusive:end,k,priority_zone:priority,factor,name};
    const result={id:crypto.randomUUID().replaceAll('-','').slice(0,12),scenario,name,created_at:new Date().toISOString()};
    try{localStorage.setItem(storageKey,JSON.stringify([result,...saved()].slice(0,30)));}catch{throw Error('当前浏览器不能保存，请允许网站存储后重试');}
    return result;
  }
  async function api(url,options){
    await load();const u=new URL(url,location.origin);
    if(u.pathname==='/api/bootstrap')return {...data,saved:saved()};
    if(u.pathname==='/api/overview')return overview(u.searchParams);
    if(u.pathname==='/api/orders')return orderRows(u.searchParams);
    if(u.pathname==='/api/scenarios'&&options?.method==='POST')return saveScenario(JSON.parse(options.body));
    throw Error('操作不存在');
  }
  function exportOrders(params){
    if(!orders)throw Error('数据尚未加载');const {rows}=orderRows(params,true);
    const cell=v=>v==null?'':'"'+String(v).replaceAll('"','""')+'"';
    const csv='\uFEFF'+[orderFields.join(','),...rows.map(r=>orderFields.map(k=>cell(r[k])).join(','))].join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='orders.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return {api,exportOrders};
})();
