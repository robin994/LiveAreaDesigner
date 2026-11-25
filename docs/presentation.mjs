import { SCREEN } from './geometry.mjs?v=1.33';

export function drawScreenBackdrop(ctx) {
  const { width, height } = SCREEN;
  const backdrop = ctx.createLinearGradient(0, 0, 0, height);
  backdrop.addColorStop(0, '#06193d');
  backdrop.addColorStop(.55, '#154078');
  backdrop.addColorStop(1, '#216697');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);

  const light = ctx.createLinearGradient(0, height * .54, 0, height);
  light.addColorStop(0, '#7edaff00');
  light.addColorStop(.6, '#7adaff70');
  light.addColorStop(1, '#66adff10');
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.moveTo(0, height * .84);
  ctx.bezierCurveTo(width * .31, height * .99, width * .56, height * .56, width, height * .69);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.fill();
}

export function drawBubble(ctx, source, x, y, size) {
  const centerX = x + size / 2, centerY = y + size / 2;
  const circle = () => {
    ctx.beginPath();
    ctx.arc(centerX, centerY, size / 2 - 1, 0, 2 * Math.PI);
  };
  ctx.save();
  circle();
  ctx.clip();
  ctx.fillStyle = '#182b47';
  ctx.fillRect(x, y, size, size);
  if (source) ctx.drawImage(source, x, y, size, size);
  const shade = ctx.createRadialGradient(centerX - size * .16, centerY - size * .2,
    size * .1, centerX, centerY, size / 2);
  shade.addColorStop(0, '#ffffff20');
  shade.addColorStop(.7, '#07152500');
  shade.addColorStop(.96, '#020a235b');
  shade.addColorStop(1, '#5b94b770');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, size, size);
  const gloss = ctx.createLinearGradient(0, y, 0, y + size * .48);
  gloss.addColorStop(0, '#ffffff66');
  gloss.addColorStop(1, '#ffffff00');
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.ellipse(centerX, y + size * .25, size * .41, size * .19, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.save();
  circle();
  ctx.strokeStyle = '#c2e6f68c';
  ctx.lineWidth = Math.max(1, size / 128);
  ctx.stroke();
  ctx.restore();
}

export function drawHomePreview(ctx, icon, title) {
  drawScreenBackdrop(ctx);
  const x = (SCREEN.width - 128) / 2, y = (SCREEN.height - 128) / 2 - 12;
  ctx.save();
  ctx.shadowColor = '#04172caf';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 9;
  ctx.fillStyle = '#24394f';
  ctx.beginPath();
  ctx.arc(x + 64, y + 64, 61, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  drawBubble(ctx, icon, x, y, 128);
  ctx.save();
  ctx.font = '600 18px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5faff';
  ctx.shadowColor = '#03192c';
  ctx.shadowBlur = 5;
  ctx.fillText(title, SCREEN.width / 2, y + 161, 320);
  ctx.restore();
}
