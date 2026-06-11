import { APP_THEME_STORAGE_KEY } from '../../lib/theme/constants';
import { darkTokens, lightTokens } from '../../lib/theme/tokens';

function buildInitScript(): string {
  const light = JSON.stringify(lightTokens);
  const dark = JSON.stringify(darkTokens);

  return `(function(){
try{
var k='${APP_THEME_STORAGE_KEY}';
var t=localStorage.getItem(k);
if(t!=='dark'&&t!=='light')t='light';
var r=document.documentElement;
var tokens=t==='dark'?${dark}:${light};
r.setAttribute('data-theme',t);
r.setAttribute('data-mantine-color-scheme',t);
r.classList.toggle('dark',t==='dark');
r.style.colorScheme=t;
var map={
  '--app-bg':tokens.bg,
  '--app-surface':tokens.surface,
  '--app-surface-raised':tokens.surfaceRaised,
  '--app-header':tokens.header,
  '--app-text':tokens.text,
  '--app-text-muted':tokens.textMuted,
  '--app-border':tokens.border,
  '--app-border-subtle':tokens.borderSubtle,
  '--chart-text':tokens.chartText,
  '--chart-grid':tokens.chartGrid,
  '--chart-panel':tokens.chartPanel,
  '--chart-tooltip-bg':tokens.chartTooltipBg,
  '--app-accent':tokens.accent,
  '--app-card-shadow':tokens.cardShadow,
  '--background':tokens.bg,
  '--foreground':tokens.text,
  '--surface':tokens.surface
};
for(var p in map){if(map[p])r.style.setProperty(p,map[p]);}
}catch(e){}
})();`;
}

/** Aplica el tema guardado antes de hidratar React */
export function ThemeInitScript() {
  return <script dangerouslySetInnerHTML={{ __html: buildInitScript() }} />;
}
