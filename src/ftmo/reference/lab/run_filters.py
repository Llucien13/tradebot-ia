"""Fixed, predeclared indicator/filter grid for GOLD M15; PAPER ONLY.
Known 2025 and 2026 are NOT held-out: prior research optimized on both periods.
"""
import sys,itertools,time,json
from pathlib import Path
import numpy as np,pandas as pd
# Packaged local imports; trading and filter rules remain identical.
from moteur_sortie_M5 import b,idx,A,entry,trend,mk_candidates,simulate_fine
out=Path(__file__).resolve().parent
cl=b.close.astype(float);hi=b.high.astype(float);lo=b.low.astype(float)
prev=cl.shift(1);atr=b.atr.astype(float)
ema20=cl.ewm(span=20,adjust=False,min_periods=20).mean().shift(1)
ema50=cl.ewm(span=50,adjust=False,min_periods=50).mean().shift(1)
ema200=cl.ewm(span=200,adjust=False,min_periods=200).mean().shift(1)
up=hi.diff();dn=lo.shift(1)-lo
pdm=pd.Series(np.where((up>dn)&(up>0),up,0),index=idx)
mdm=pd.Series(np.where((dn>up)&(dn>0),dn,0),index=idx)
tr=pd.concat([hi-lo,(hi-cl.shift()).abs(),(lo-cl.shift()).abs()],axis=1).max(axis=1)
w=lambda s:s.ewm(alpha=1/14,adjust=False,min_periods=14).mean()
pdi=100*w(pdm)/w(tr).replace(0,np.nan);mdi=100*w(mdm)/w(tr).replace(0,np.nan)
adx=w(100*(pdi-mdi).abs()/(pdi+mdi).replace(0,np.nan)).shift(1)
pdi=pdi.shift(1);mdi=mdi.shift(1)
changes=cl.diff();g=w(changes.clip(lower=0));l=w((-changes).clip(lower=0));rsi=(100-100/(1+g/l.replace(0,np.nan))).shift(1)
atr_ratio=atr/atr.shift(1).rolling(50,min_periods=50).mean()
bbw=(4*cl.rolling(20).std().shift(1)/prev)
bbw_ratio=bbw/bbw.shift(1).rolling(96,min_periods=96).median()
body=(b.triggerclose-b.triggeropen).abs()/(b.triggerhigh-b.triggerlow).replace(0,np.nan)
hour=idx.hour;wd=idx.dayofweek
F={}
def add(n,a,z=None):
 if z is None:z=a
 F[n]=(pd.Series(a,index=idx).fillna(False).to_numpy(dtype=bool),pd.Series(z,index=idx).fillna(False).to_numpy(dtype=bool))
add('EMA20_50',ema20>ema50,ema20<ema50)
add('EMA50_200',ema50>ema200,ema50<ema200)
add('PRICE_EMA20',prev>ema20,prev<ema20)
add('PRICE_EMA50',prev>ema50,prev<ema50)
add('EMA20_50_PRICE',(ema20>ema50)&(prev>ema20),(ema20<ema50)&(prev<ema20))
add('EMA_GAP_02ATR',(ema20-ema50)>.2*atr,(ema50-ema20)>.2*atr)
add('EMA20_SLOPE',ema20>ema20.shift(4),ema20<ema20.shift(4))
for x in [15,20,25,30]:add(f'ADX_GE_{x}',adx>=x)
for x in [15,20,25]:add(f'ADX_LT_{x}',adx<x)
add('DI_DIRECTION',pdi>mdi,pdi<mdi)
add('ADX20_DI',(adx>=20)&(pdi>mdi),(adx>=20)&(pdi<mdi))
for x in [50,55,60]:add(f'RSI_DIR_{x}',rsi>=x,rsi<=100-x)
add('RSI_MIDDLE',rsi.between(45,70),rsi.between(30,55))
add('RSI_NOT_EXTREME',rsi.between(30,70))
for x in [.65,.85,1.,1.2]:add(f'ATR_MIN_{x}',atr_ratio>=x)
for x in [1.5,2.]:add(f'ATR_MAX_{x}',atr_ratio<=x)
add('ATR_BAND_075_18',atr_ratio.between(.75,1.8))
add('ATR_BAND_08_22',atr_ratio.between(.8,2.2))
add('BB_WIDENING',bbw_ratio>=1.05)
add('BB_TIGHT',bbw_ratio<.9)
add('BB_MEDIAN_PLUS',bbw_ratio>=1.)
add('BB_MID_BAND',bbw_ratio.between(.75,1.8))
add('M30_CONFIRM',b.m30_mom3>0,b.m30_mom3<0)
add('H1_CONFIRM',b.h1_mom6>0,b.h1_mom6<0)
for x in [.3,.5,.7]:add(f'BODY_GE_{x}',body>=x)
for x in [.1,.2]:add(f'BREAK_ATR_{x}',(b.triggerclose-b.priorhi8)>x*atr,(b.priorlo8-b.triggerclose)>x*atr)
for nm,hours in [('0_5',range(0,6)),('6_11',range(6,12)),('12_17',range(12,18)),('18_23',range(18,24)),('6_17',range(6,18)),('8_20',range(8,21)),('9_16',range(9,17)),('12_21',range(12,22)),('NO_ROLLOVER',range(3,22))]:add('HOURS_'+nm,np.isin(hour,list(hours)))
add('NO_FRIDAY_PM',~((wd==4)&(hour>=17)))
add('MON_THU',wd<4)
GO,DIST=mk_candidates('break8','H4_D1_mom','atr',2.5)

def masked(names):
 go=GO.copy()
 for k in names:
  a,z=F[k]
  go=np.where(((go==1)&a)|((go==-1)&z),go,0).astype('int8')
 return go

def measure(names,spread=.3,go=None):
 if go is None:go=masked(names)
 ans=[]
 for year in [2025,2026]:
  s,_=simulate_fine(year,go,DIST,tpR=2.5,expiry_bars=32,spread=spread,risk_percent=2)
  ans.append(dict(filters=' & '.join(names) if names else 'AUCUN',n=len(names),spread=spread,**s))
 return ans

def main():
 st=time.time();print('loaded indicators',len(F),'baseline',flush=True)
 singles=[()]+[(x,) for x in F]
 runs=[]
 for ii,names in enumerate(singles):
  runs.extend(measure(names))
 print('singles',len(singles),'elapsed',round(time.time()-st,1),flush=True)
 pd.DataFrame(runs).to_csv(out/'01_SIMPLES.csv',index=False)
 ema=['EMA20_50','EMA50_200','PRICE_EMA20','EMA20_50_PRICE','EMA_GAP_02ATR']
 ad=['ADX_GE_15','ADX_GE_20','ADX_GE_25','ADX_GE_30','ADX20_DI','DI_DIRECTION']
 rsi=['RSI_DIR_50','RSI_DIR_55','RSI_NOT_EXTREME','M30_CONFIRM','H1_CONFIRM']
 vol=['ATR_MIN_0.65','ATR_MIN_0.85','ATR_MIN_1.0','ATR_MAX_2.0','ATR_BAND_075_18','BB_WIDENING','BB_MEDIAN_PLUS']
 hours=['HOURS_6_17','HOURS_8_20','HOURS_12_21','HOURS_NO_ROLLOVER','NO_FRIDAY_PM']
 groups=[(ema,ad),(ema,rsi),(ad,vol),(ad,hours),(ema,hours),(vol,hours),(ema,vol),(rsi,vol),(rsi,hours)]
 pairs=[tuple(sorted(x)) for a,z in groups for x in itertools.product(a,z)]
 triple=[tuple(sorted(x)) for x in itertools.product(['EMA20_50','EMA20_50_PRICE','EMA50_200'],['ADX_GE_15','ADX_GE_20','ADX_GE_25','DI_DIRECTION'],['HOURS_6_17','HOURS_8_20','HOURS_NO_ROLLOVER','ATR_BAND_075_18','ATR_MIN_0.85','RSI_DIR_50','BB_WIDENING'])]
 combos=list(dict.fromkeys(pairs+triple))
 print('combination count',len(combos),flush=True)
 for k,names in enumerate(combos):
  runs.extend(measure(names))
  if (k+1)%50==0:print('combinations',k+1,'elapsed',round(time.time()-st,1),flush=True)
 pd.DataFrame(runs).to_csv(out/'02_TOUTES_COMBINAISONS.csv',index=False)
 d=pd.DataFrame(runs)
 p=d.pivot(index=['filters','n'],columns='year',values=['pnl','trades','drawdown','pf']);p.columns=[f'{x}_{yr}' for x,yr in p.columns];p=p.reset_index()
 p['worst_year']=p[['pnl_2025','pnl_2026']].min(axis=1);p['total_pnl']=p.pnl_2025+p.pnl_2026;p['max_dd']=p[['drawdown_2025','drawdown_2026']].max(axis=1)
 p['sufficient']=(p.trades_2025>=80)&(p.trades_2026>=40)
 p['score']=np.where(p.sufficient,p.worst_year-20*np.maximum(0,p.max_dd-25),-1e6+p.worst_year)
 p.sort_values('score',ascending=False).to_csv(out/'03_CLASSEMENT.csv',index=False)
 print('TOP',p.sort_values('score',ascending=False).head(18).to_string(index=False),flush=True)
 print('FINISHED',round(time.time()-st,1),flush=True)
if __name__=='__main__':main()
