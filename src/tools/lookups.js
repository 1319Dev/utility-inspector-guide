/**
 * Lookups — pipe size / SDR table + material ID cheat sheet
 */
export function mountLookups(el) {
  el.innerHTML = `
    <div class="card">
      <h3>Common PE pipe (IPS) — approx OD</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Nom.</th><th>OD (in)</th><th>SDR-11 wall</th><th>SDR-11 ID≈</th></tr></thead>
          <tbody>
            <tr><td>1"</td><td>1.315</td><td>0.120</td><td>1.08</td></tr>
            <tr><td>2"</td><td>2.375</td><td>0.216</td><td>1.94</td></tr>
            <tr><td>3"</td><td>3.500</td><td>0.318</td><td>2.86</td></tr>
            <tr><td>4"</td><td>4.500</td><td>0.409</td><td>3.68</td></tr>
            <tr><td>6"</td><td>6.625</td><td>0.602</td><td>5.42</td></tr>
            <tr><td>8"</td><td>8.625</td><td>0.784</td><td>7.06</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted">SDR = OD / wall. Confirm manufacturer charts for DR / CTS / steel.</p>
    </div>
    <div class="card">
      <h3>Steel pipe — nom. vs OD (in)</h3>
      <div class="table-wrap">
        <table class="data">
          <thead><tr><th>Nom.</th><th>OD</th><th>Nom.</th><th>OD</th></tr></thead>
          <tbody>
            <tr><td>1"</td><td>1.315</td><td>4"</td><td>4.500</td></tr>
            <tr><td>2"</td><td>2.375</td><td>6"</td><td>6.625</td></tr>
            <tr><td>3"</td><td>3.500</td><td>8"</td><td>8.625</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Material ID cheat sheet</h3>
      <div class="list">
        <div class="list-item"><strong>PE / HDPE</strong><span class="meta">Black (or yellow jacket for gas), fused joints, print line with SDR/DR, resin code</span></div>
        <div class="list-item"><strong>Steel</strong><span class="meta">Magnetic, threaded/welded/flanged, may be coated or wrapped; wall thickness stamps</span></div>
        <div class="list-item"><strong>DI (ductile iron)</strong><span class="meta">Heavy, bell &amp; spigot, cement-lined common for water; exterior coatings</span></div>
        <div class="list-item"><strong>PVC</strong><span class="meta">White/gray/blue/green by use, solvent or gasket joints, not for gas distribution in most US systems</span></div>
        <div class="list-item"><strong>Copper</strong><span class="meta">Reddish, soft or hard tube; common for services; type K/L/M markings</span></div>
      </div>
      <p class="disclaimer muted">Visual ID only — verify with records, locates, and company procedures before cutting or connecting.</p>
    </div>
  `;
}
