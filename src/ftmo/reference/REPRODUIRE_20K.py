from FTMO_20K_EUR_RUN import replay
import json
from pathlib import Path
p=Path('resultats_recalcules');p.mkdir(exist_ok=True)
for year in [2025,2026]:
  for tp in [2.5,5.0]:
    summary,trades,monthly,phases,fail=replay(year,tp,spread=.30,phase_reset=True)
    label=f'{year}_TP{str(tp).replace(".","p")}'
    trades.to_csv(p/f'{label}_trades.csv',index=False)
    (p/f'{label}_bilan.json').write_text(json.dumps({'summary':summary,'phases':phases},default=float,indent=2))
    print(label,summary['phase1_status'],summary['phase1_end'],summary['phase2_status'],summary['phase2_end'])
