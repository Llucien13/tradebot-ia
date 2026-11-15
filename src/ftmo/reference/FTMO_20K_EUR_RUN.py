"""Exploratory historical comparison FTMO 2-Step 25k, GOLD M15 frozen candidate.
Uses archived strategy logic unchanged except TP multiplier, initial balance, risk sizing.
Uses an approximate MT5 server day for FTMO rule checks: NOT sufficient for FTMO compliance.
Trades 2025 and Jan 1-Oct 9 2026; already optimized periods, so not out-of-sample.
"""
import os,sys,json,math
from pathlib import Path
import numpy as np,pandas as pd
ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'lab'))
from run_filters import idx,b,A,masked,DIST
from moteur_sortie_M5 import segments,contiguous,segs
GO=masked(('EMA50_200','M30_CONFIRM'))
START_EQ=20000.; LEVERAGE=20; RISK=.005; MIN_LOT=.01
NORM_SPREAD=.30; SLIP_EACH=.05; COMM_EACH_PER_LOT=3.0
MAX_DAILY_LOSS=1000.; MAX_TOTAL_LOSS=2000.; MIN_DAYS=4

fx_mode='mt5_2026'   # use 'constant' for scenario 2025
FX_FIXED=1.15  # USD per 1 EUR; explicit scenario assumption for 2025
fx_file=ROOT/'EURUSD_M5_202512010000_202610092355.csv'
fx_data=pd.read_csv(fx_file,sep='\t')
fx_ts=pd.to_datetime(fx_data['<DATE>']+' '+fx_data['<TIME>'],format='%Y.%m.%d %H:%M:%S').to_numpy(dtype='datetime64[ns]')
fx_v=((fx_data['<OPEN>']+fx_data['<CLOSE>'])/2).to_numpy(dtype=float)

def fx_at(time,year):
    if year==2025 or fx_mode=='constant': return FX_FIXED
    pos=int(np.searchsorted(fx_ts,np.datetime64(time,'ns'),side='right'))-1
    if pos<0: return FX_FIXED
    return float(fx_v[pos])

def replay(year,tp_r,spread=.3,phase_reset=False):
    st,en=segments[year]
    i=int(np.searchsorted(idx.values,st)); end=int(np.searchsorted(idx.values,en))
    balance=START_EQ;peak=START_EQ;max_dd_closed=0.;peak_float=START_EQ;dd_float=0.
    phase=1;days=set();phase_start=None;phase_record=[]
    signal=0;rejected_risk=0;rejected_margin=0;gap_count=0;fallback=0;used_m5=0;trades=[]
    day_key=None;day_base=START_EQ;ftmo_fail=None;min_margin=1e9;max_sig_risk=0
    fee_per_lot=(spread+2*SLIP_EACH)*100+2*COMM_EACH_PER_LOT
    while i<end:
        side=int(GO[i])
        if not side:i+=1;continue
        signal+=1
        ent=float(A['open'][i]);dist=float(DIST[i]);
        if (dist*100+fee_per_lot)*MIN_LOT/fx_at(idx[i],year)>RISK*balance+1e-8:
            rejected_risk+=1;i+=1;continue
        rate_entry=fx_at(idx[i],year)
        minmargin=ent*100*MIN_LOT/LEVERAGE/rate_entry
        if minmargin>balance:
            rejected_margin+=1;i+=1;continue
        raw=balance*RISK*rate_entry/(100*dist+fee_per_lot)
        lot=round(np.floor((min(raw,balance*LEVERAGE*rate_entry/(ent*100))+1e-9)/.01)*.01,2)
        if lot<.01: rejected_risk+=1;i+=1;continue
        stop=ent-side*dist; target=ent+side*dist*tp_r
        max_sig_risk=max(max_sig_risk,(lot*(100*dist+fee_per_lot)/rate_entry)/balance)
        entry_ts=idx[i]; entry_day=str(entry_ts.date())
        if day_key!=entry_day:
            day_key=entry_day;day_base=balance
        days.add(entry_day)
        if phase_start is None:phase_start=str(entry_ts)
        reason='TIME';ex=ent;endbar=i;close_ts=entry_ts
        for j in range(i,min(end,i+32)):
            if j in segs:
                op,hi,lo,cl=segs[j];used_m5+=1
            else:
                op=[float(A['open'][j])];hi=[float(A['high'][j])];lo=[float(A['low'][j])];cl=[float(A['close'][j])];fallback+=1
            if j>i and not contiguous[j]:gap_count+=1
            for step,(o,h,l,c) in enumerate(zip(op,hi,lo,cl)):
                o,h,l,c=float(o),float(h),float(l),float(c)
                tm=idx[j]+pd.Timedelta(minutes=(step*5 if j in segs else 0))
                today=str(tm.date())
                if today!=day_key:
                    # In FTMO, midnight resets the daily floor based on balance, not unrealized P/L.
                    # Server-day proxy pending mapping to CE(S)T.
                    day_key=today;day_base=balance
                if side==1:
                    worst=l
                    stop_touch=l<=stop;tp_touch=h>=target
                    if (j>i or step>0) and o<=stop:ex=o;reason='SL_GAP'
                    elif (j>i or step>0) and o>=target:ex=target;reason='TP_GAP'
                    elif stop_touch:ex=stop;reason='SL'
                    elif tp_touch:ex=target;reason='TP'
                    else:ex=c
                else:
                    worst=h
                    stop_touch=h>=stop;tp_touch=l<=target
                    if (j>i or step>0) and o>=stop:ex=o;reason='SL_GAP'
                    elif (j>i or step>0) and o<=target:ex=target;reason='TP_GAP'
                    elif stop_touch:ex=stop;reason='SL'
                    elif tp_touch:ex=target;reason='TP'
                    else:ex=c
                # Equity using OHLC worst extreme (may extend beyond SL, so conservative).
                # Clip to actual executed stop/target within the subbar; gap exit uses open.
                # The raw OHLC extreme can occur after the stop has already filled.
                if reason != 'TIME':
                    worst_effective = min(ent,ex) if side==1 else max(ent,ex)
                else:
                    worst_effective = worst
                rate_now=fx_at(tm,year)
                worst_equity=balance+((worst_effective-ent)*side*100*lot-lot*fee_per_lot)/rate_now
                mid_equity=balance+((c-ent)*side*100*lot-lot*fee_per_lot)/rate_now
                peak_float=max(peak_float,mid_equity)
                dd_float=max(dd_float,(peak_float-worst_equity)/max(peak_float,1))
                daily_limit=day_base-MAX_DAILY_LOSS
                total_limit=START_EQ-MAX_TOTAL_LOSS
                min_margin=min(min_margin,worst_equity-max(daily_limit,total_limit))
                if worst_equity<max(daily_limit,total_limit)-1e-6:
                    ftmo_fail={'phase':phase,'time':str(tm),'equity':round(worst_equity,2),'daily_floor':round(daily_limit,2),'total_floor':round(total_limit,2)}
                    reason='FTMO_FAIL_EQUITY'
                    ex=c
                    break
                close_ts=tm
                if reason!='TIME':break
            endbar=j
            if reason!='TIME':break
        if reason=='TIME':close_ts=idx[endbar]+pd.Timedelta(minutes=15)
        pnl_usd=(ex-ent)*side*100*lot-lot*fee_per_lot
        pnl=round(pnl_usd/fx_at(close_ts,year),9)
        balance+=pnl
        peak=max(peak,balance)
        max_dd_closed=max(max_dd_closed,(peak-balance)/peak)
        trades.append({'year':year,'TP_R':tp_r,'spread':spread,'phase':phase,'entry':str(entry_ts),'exit':str(close_ts),'lot':lot,'side':side,'entry_price':ent,'stop_price':stop,'tp_price':target,'exit_price':ex,'exit_reason':reason,'fx_usd_per_eur_entry':round(rate_entry,6),'fx_usd_per_eur_exit':round(fx_at(close_ts,year),6),'pnl':pnl,'pnl_usd':pnl_usd,'equity_after':balance,'num_days_in_phase':len(days)})
        if ftmo_fail:break
        if phase_reset and balance >= START_EQ*(1+(.10 if phase==1 else .05)) and len(days)>=MIN_DAYS:
            phase_record.append({'phase':phase,'status':'TARGET_CLOSED','start':phase_start,'end':str(close_ts),'trades':sum(t['phase']==phase for t in trades),'days':len(days),'equity':round(balance,2)})
            if phase==2:
                phase=3;break
            phase=2;balance=START_EQ;peak=START_EQ;peak_float=START_EQ;days=set();phase_start=None;day_base=START_EQ;day_key=None
        i=endbar+1
    if phase_reset and phase<=2:
        if ftmo_fail:
            phase_record.append({'phase':phase,'status':'FAIL_EQUITY','start':phase_start,'end':ftmo_fail['time'],'trades':sum(t['phase']==phase for t in trades),'days':len(days),'equity':round(balance,2)})
        else:
            phase_record.append({'phase':phase,'status':'NOT_REACHED','start':phase_start,'end':str(idx[end-1]),'trades':sum(t['phase']==phase for t in trades),'days':len(days),'equity':round(balance,2)})
    monthly={}
    for t in trades:
        k=t['exit'][:7]
        monthly[k]=monthly.get(k,0)+t['pnl']
    summary={'year':year,'fx_mode':fx_mode if year!=2025 else 'constant_2025','tpR':tp_r,'spread':spread,'phases_reset':phase_reset,'net':round(sum(t['pnl'] for t in trades),2),'end_balance':round(balance,2),'trades':len(trades),'signals':signal,'refused_risk':rejected_risk,'refused_margin':rejected_margin,'max_dd_closed_pct':round(max_dd_closed*100,2),'max_dd_ohlc_pct':round(dd_float*100,2),'max_planned_risk_pct':round(max_sig_risk*100,2),'min_ftmo_cushion_eur':round(min_margin,2),'FTMO_equity_fail':bool(ftmo_fail),'phase1_status':next((x['status'] for x in phase_record if x['phase']==1),None),'phase1_end':next((x['end'] for x in phase_record if x['phase']==1),None),'phase2_status':next((x['status'] for x in phase_record if x['phase']==2),None),'phase2_end':next((x['end'] for x in phase_record if x['phase']==2),None)}
    return summary,pd.DataFrame(trades),monthly,phase_record,ftmo_fail

