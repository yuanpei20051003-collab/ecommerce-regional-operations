'use strict';
// All C(24,k) subsets are evaluated. No greedy heuristic or network solver is used.
function haversine(a,b){
  const rad=Math.PI/180, da=(b[0]-a[0])*rad, db=(b[1]-a[1])*rad;
  const x=Math.sin(da/2)**2+Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(db/2)**2;
  return 6371.0088*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,x))));
}
function solve(zones,weights,k){
  const n=zones.length;
  if(!Number.isInteger(k)||k<1||k>n||weights.length!==n||weights.some(w=>!Number.isFinite(w)||w<0)||weights.reduce((a,b)=>a+b,0)<=0)throw Error('无效的规划输入');
  const distances=zones.map(s=>Float64Array.from(zones,z=>haversine([z.lat,z.lon],[s.site_lat,s.site_lon])));
  const layers=Array.from({length:k+1},()=>new Float64Array(n));layers[0].fill(Infinity);
  const selected=new Array(k);let best=Infinity,bestSites=[],examined=0;
  function visit(start,depth){
    for(let j=start;j<=n-(k-depth);j++){
      selected[depth]=j;const prev=layers[depth],next=layers[depth+1],d=distances[j];let cost=0;
      for(let i=0;i<n;i++){const v=Math.min(prev[i],d[i]);next[i]=v;cost+=v*weights[i];}
      if(depth+1===k){examined++;if(cost<best){best=cost;bestSites=selected.slice();}}
      else visit(j+1,depth+1);
    }
  }
  visit(0,0);
  return {sites:bestSites,objective_km_orders:best,solver_success:true,solver_method:'exact_subset_enumeration',subsets_examined:examined,optimality_gap:0,solver_message:'穷举全部候选点组合，取得全局最优解'};
}
function actualMetrics(points,sites){
  if(!points.length)throw Error('回放窗口内没有订单');
  const ds=points.map(p=>Math.min(...sites.map(s=>haversine(p,[s.site_lat,s.site_lon])))).sort((a,b)=>a-b);
  const q=.9*(ds.length-1),lo=Math.floor(q),hi=Math.ceil(q);
  return {mean_km:ds.reduce((a,b)=>a+b,0)/ds.length,p90_km:ds[lo]+(ds[hi]-ds[lo])*(q-lo),coverage_3km:ds.filter(d=>d<=3).length/ds.length,coverage_5km:ds.filter(d=>d<=5).length/ds.length,orders:ds.length};
}
function calculate(payload){
  const t=performance.now(),plan=solve(payload.zones,payload.weights,payload.k);
  plan.metrics=actualMetrics(payload.points,plan.sites.map(i=>payload.zones[i]));
  plan.elapsed_seconds=(performance.now()-t)/1000;return plan;
}
if(typeof module!=='undefined'&&module.exports)module.exports={haversine,solve,actualMetrics,calculate};
else self.onmessage=event=>{try{self.postMessage({ok:true,plan:calculate(event.data)});}catch(e){self.postMessage({ok:false,error:e.message});}};
