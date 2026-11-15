const format = (time: number, timeZone: string) => new Date(time).toLocaleString("fr-FR", { timeZone, timeZoneName: "short" });

export function MT5ClockDetails({ tickTime, fetchedAt }: { tickTime: number; fetchedAt: string }) {
  const bridgeTime = Date.parse(fetchedAt);
  const age = (bridgeTime - tickTime) / 1000;
  return <div className="space-y-2 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
    <h3 className="font-semibold">Horodatages MT5 · comparaison sans correction horaire</h3>
    <dl className="grid gap-3 sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Tick · Europe/Paris</dt><dd className="mt-1 font-mono">{format(tickTime, "Europe/Paris")}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Même tick · UTC</dt><dd className="mt-1 font-mono">{format(tickTime, "UTC")}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Lecture passerelle · Europe/Paris</dt><dd className="mt-1 font-mono">{format(bridgeTime, "Europe/Paris")}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Lecture passerelle · UTC</dt><dd className="mt-1 font-mono">{format(bridgeTime, "UTC")}</dd></div>
    </dl>
    <p>Écart au moment de la lecture : <strong>{age.toFixed(3)} s</strong> (positif : tick plus ancien ; négatif : tick en avance).</p>
    {(age > 15 || age < -5) && <p className="font-semibold">Horodatage hors des limites FTMO : ancienneté maximale 15 s, avance maximale 5 s. La connexion seule ne confirme pas la fraîcheur du flux.</p>}
    <p className="text-xs text-muted-foreground">Les deux colonnes décrivent les mêmes instants. Europe/Paris gère automatiquement l’heure d’été/hiver. Les bougies ci-dessous restent affichées en UTC, sans modifier leurs horodatages. Cette mesure est un instantané ; le test FTMO refait le contrôle côté Python.</p>
  </div>;
}
