/**
 * Generates and downloads a stamped Travel Postcard PNG combining the current viewport canvas (if accessible)
 * and a rich location / altitude / telemetry stamp banner.
 */
export function downloadTravelPostcard(params: {
  title: string;
  subtitle: string;
  lat: number;
  lng: number;
  altitudeMeters?: number;
  speedKmh: number;
  headingDeg: number;
  modeLabel: string;
  sourceCanvas?: HTMLCanvasElement | null;
}): void {
  const width = 1200;
  const height = 740;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Base gradient sky/horizon backdrop
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#09111E');
  bg.addColorStop(0.65, '#132238');
  bg.addColorStop(1, '#070B12');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // Attempt to composite live WebGL canvas snapshot (falls back cleanly if tainted or absent)
  let drewLiveCanvas = false;
  if (params.sourceCanvas) {
    try {
      ctx.drawImage(params.sourceCanvas, 0, 0, width, height);
      drewLiveCanvas = true;
    } catch {
      drewLiveCanvas = false;
    }
  }

  if (!drewLiveCanvas) {
    // Crisp vector flight/horizon motif for guaranteed high-contrast postcard
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(120, 440);
    ctx.quadraticCurveTo(600, 170, 1080, 320);
    ctx.stroke();
  }

  // Bottom editorial scrim
  const scrim = ctx.createLinearGradient(0, height - 240, 0, height);
  scrim.addColorStop(0, 'rgba(6, 10, 18, 0)');
  scrim.addColorStop(0.45, 'rgba(6, 10, 18, 0.78)');
  scrim.addColorStop(1, 'rgba(6, 10, 18, 0.96)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, height - 240, width, 240);

  // Postcard frame border
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, width - 36, height - 36);

  // Brand & Mode stamp
  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(`ROADWINDOW 360 · ${params.modeLabel}`, 52, height - 150);

  // Main Location Title
  ctx.fillStyle = '#F8FAFC';
  ctx.font = 'bold 42px "Plus Jakarta Sans", "Noto Sans KR", sans-serif';
  ctx.fillText(params.title, 52, height - 96);

  // Subtitle
  ctx.fillStyle = '#CBD5E1';
  ctx.font = '500 22px "Plus Jakarta Sans", "Noto Sans KR", sans-serif';
  ctx.fillText(params.subtitle, 52, height - 56);

  // Right Telemetry Block
  ctx.textAlign = 'right';
  ctx.fillStyle = '#38BDF8';
  ctx.font = 'bold 22px "JetBrains Mono", monospace';
  const altPart =
    typeof params.altitudeMeters === 'number'
      ? `ALT ${Math.round(params.altitudeMeters).toLocaleString()}m · `
      : '';
  ctx.fillText(
    `${altPart}${Math.round(params.speedKmh)} km/h · HDG ${Math.round(params.headingDeg)}°`,
    width - 52,
    height - 96
  );

  ctx.fillStyle = '#94A3B8';
  ctx.font = '18px "JetBrains Mono", monospace';
  ctx.fillText(
    `${params.lat.toFixed(4)}°N, ${params.lng.toFixed(4)}°E · ${new Date().toLocaleDateString('ko-KR')}`,
    width - 52,
    height - 56
  );

  const link = document.createElement('a');
  link.download = `roadwindow360-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
