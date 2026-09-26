// Styles for app/routes/app.sending-domain.tsx, ported from the "Nomi Sending
// Domain" design. Rendered as a <style> element from the route bundle rather
// than added to nomi.css: new classes in the external stylesheet have failed
// to apply inside the embedded admin iframe before (see CAMPAIGNS.md, "The
// inline-style thing"). Everything is scoped under `.nomi-sd`.

const S = ".nomi-sd";

export const SENDING_DOMAIN_CSS = `
${S}{--sd-ink:#201e1d;--sd-ink-2:#444141;--sd-mute:#605d5d;--sd-mute-2:#716d6d;--sd-line:#d7d3d3;--sd-line-2:#eae7e7;--sd-wash:#f8f4f4;--sd-cyan:#0088b0;--sd-cyan-d:#00789e;--sd-cyan-dd:#004961;--sd-cyan-w:#e9f8ff;--sd-mag:#d6006c;--sd-mag-d:#a3004f;--sd-mag-w:#fbe5ef;
  --sd-sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--sd-serif:"Source Serif 4",Georgia,serif;--sd-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  font-family:var(--sd-sans);color:var(--sd-ink);-webkit-font-smoothing:antialiased}
${S} *{box-sizing:border-box}
${S} a{color:var(--sd-cyan-d)}
${S} a:hover{color:var(--sd-cyan-dd)}
${S} button{font-family:var(--sd-sans)}
${S} .head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;padding-bottom:18px;border-bottom:2px solid var(--sd-ink)}
${S} .head-l{display:flex;align-items:flex-end;gap:10px;min-width:0}
${S} .back{width:44px;height:44px;flex:none;display:grid;place-items:center;color:var(--sd-ink);text-decoration:none;font-size:24px;margin-left:-10px}
${S} .back:hover{color:var(--sd-cyan-d)}
${S} .crumb{font-size:10px;font-weight:600;letter-spacing:.2em;text-transform:uppercase;color:var(--sd-mute-2);margin-bottom:6px}
${S} h1{margin:0;font:700 44px/1.1 var(--sd-serif);letter-spacing:-.01em;color:var(--sd-ink)}
${S} .steps{list-style:none;margin:0 0 32px;padding:0;display:flex;border-bottom:1px solid var(--sd-line)}
${S} .steps li{flex:1;display:flex;align-items:baseline;gap:10px;padding:16px 0 14px;margin-bottom:-1px;border-bottom:2px solid transparent;color:var(--sd-mute-2);font-size:13px}
${S} .steps li b{font:500 12px var(--sd-mono);color:inherit}
${S} .steps li.on{color:var(--sd-ink);border-color:var(--sd-ink);font-weight:600}
${S} .steps li.done{color:var(--sd-cyan-d)}
${S} .steps li.done b::after{content:" \\2713"}
${S} .grid{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:32px;align-items:start}
${S} .grid.full{grid-template-columns:minmax(0,1fr)}
${S} .col{display:flex;flex-direction:column;gap:24px;min-width:0}
${S} .card{background:#fff;border-radius:2px;border:1px solid var(--sd-line)}
${S} .pad{padding:36px 40px}
${S} .eyebrow{font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--sd-cyan-d)}
${S} h2{margin:10px 0 14px;font:700 26px/1.1 var(--sd-serif);color:var(--sd-ink)}
${S} h3{margin:6px 0 8px;font:700 22px/1.15 var(--sd-serif);color:var(--sd-ink)}
${S} p{margin:0;font-size:15px;line-height:1.55;color:var(--sd-ink-2)}
${S} .lede{font-size:15px;max-width:600px}
${S} .lede b{color:var(--sd-ink);font-weight:600}
${S} .field{margin-top:30px;display:flex;flex-direction:column;gap:8px;max-width:520px}
${S} .field label{font-size:12px;font-weight:600;color:var(--sd-ink)}
${S} .field input{width:100%;height:52px;padding:0 16px;border:1px solid var(--sd-line);border-radius:2px;background:#fff;color:var(--sd-ink);font:500 17px var(--sd-sans);outline:none}
${S} .field input:focus{border-color:var(--sd-cyan);box-shadow:0 0 0 3px var(--sd-cyan-w)}
${S} .field.bad input{border-color:var(--sd-mag);box-shadow:0 0 0 3px var(--sd-mag-w)}
${S} .suggest{display:inline-flex;align-items:center;gap:6px;width:fit-content;padding:4px 10px;border-radius:2px;background:var(--sd-cyan-w);color:#006786;font-size:12px;font-weight:500}
${S} .err{display:flex;align-items:flex-start;gap:8px;color:var(--sd-mag-d);font-size:13px;line-height:1.5;font-weight:500}
${S} .err svg{flex:none;margin-top:2px}
${S} .help,${S} .howto p,${S} .tip p,${S} .hostnote p,${S} .meta,${S} .purpose,${S} .prio,${S} .caution,${S} .rt-detail p{font-size:13px}
${S} .help{color:var(--sd-mute)}
${S} .subd{margin-top:26px;padding:18px 20px;border:1px solid var(--sd-line-2);border-radius:2px;background:var(--sd-wash);max-width:520px;display:flex;flex-direction:column;gap:6px}
${S} .k{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--sd-mute-2)}
${S} .mono{font:500 14px var(--sd-mono);color:var(--sd-ink);word-break:break-all}
${S} .actions{margin-top:30px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
${S} .btn{min-height:44px;padding:0 22px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--sd-ink);border-radius:2px;background:var(--sd-ink);color:#fff;font:600 14px var(--sd-sans);text-decoration:none;cursor:pointer;white-space:nowrap}
${S} .btn:hover{background:var(--sd-ink-2);border-color:var(--sd-ink-2);color:#fff}
${S} .btn:focus-visible,${S} .copy:focus-visible,${S} .linkbtn:focus-visible,${S} .x:focus-visible{outline:2px solid var(--sd-cyan);outline-offset:2px}
${S} .btn.ghost{background:#fff;color:var(--sd-ink);border-color:var(--sd-ink)}
${S} .btn.ghost:hover{background:#fff;color:var(--sd-ink);border-color:var(--sd-ink);box-shadow:inset 0 0 0 1px var(--sd-ink)}
${S} .btn.ghost:disabled{opacity:.5;cursor:not-allowed}
${S} .btn.light{background:#fff;color:var(--sd-ink);border-color:#fff}
${S} .btn.light:hover{background:var(--sd-line-2);border-color:var(--sd-line-2);color:var(--sd-ink)}
${S} .btn.danger{background:var(--sd-mag);border-color:var(--sd-mag)}
${S} .btn.danger:hover{background:var(--sd-mag-d);border-color:var(--sd-mag-d)}
${S} .btn.danger:disabled{background:var(--sd-mag-d);border-color:var(--sd-mag-d);cursor:progress}
${S} .btn.cta,${S} .btn.verify{background:var(--sd-cyan);border-color:var(--sd-cyan);color:#fff}
${S} .btn.cta:hover,${S} .btn.verify:hover{background:var(--sd-cyan-d);border-color:var(--sd-cyan-d);color:#fff}
${S} .btn.cta:disabled{background:var(--sd-cyan-d);border-color:var(--sd-cyan-d);cursor:progress}
${S} .btn.verify:disabled{background:#bfe1ee;border-color:#bfe1ee;color:#fff;cursor:not-allowed}
${S} .linkbtn{min-height:44px;padding:0 4px;border:0;background:none;color:var(--sd-cyan-d);font:600 13px var(--sd-sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
${S} .aside{display:flex;flex-direction:column}
${S} .aside h4{margin:0 0 14px;font:600 18px var(--sd-serif);color:var(--sd-ink)}
${S} .tip{display:flex;gap:14px;padding:16px 0;border-top:1px solid var(--sd-line)}
${S} .tip:last-child{border-bottom:1px solid var(--sd-line)}
${S} .tip b{font:500 12px var(--sd-mono);color:var(--sd-cyan-d);flex:none;padding-top:2px}
${S} .tip strong{display:block;color:var(--sd-ink);font-size:13px;margin-bottom:2px}
${S} .pill{display:inline-flex;align-items:center;gap:6px;width:fit-content;padding:6px 9px;border-radius:2px;font:700 10px var(--sd-sans);letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
${S} .pill i{width:6px;height:6px;border-radius:50%;background:currentColor;display:block}
${S} .pill.neutral{background:var(--sd-line-2);color:var(--sd-ink-2)}
${S} .pill.checking{background:var(--sd-cyan-w);color:var(--sd-cyan-d)}
${S} .pill.checking i{animation:sd-pulse 1s ease-in-out infinite}
${S} .pill.ok{background:var(--sd-cyan-w);color:var(--sd-cyan-d)}
${S} .pill.warn{background:#fff;color:var(--sd-mag-d);box-shadow:inset 0 0 0 1px #f0b3cf}
${S} .pill.bad{background:var(--sd-mag-w);color:var(--sd-mag-d)}
@keyframes sd-pulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes sd-spin{to{transform:rotate(360deg)}}
${S} .spin{animation:sd-spin .8s linear infinite}
${S} .summary{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:26px 32px;border-bottom:1px solid var(--sd-line-2)}
${S} .dom{margin-top:6px;font:700 26px/1.1 var(--sd-serif);overflow-wrap:anywhere}
${S} .sum-r{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
${S} .sum-r .linkbtn{min-height:32px;margin-bottom:-6px}
${S} .meta{color:var(--sd-mute)}
${S} .notice{margin:24px 32px 0;padding:16px 18px;border-radius:2px;display:flex;gap:12px;align-items:flex-start;background:#fbf3f7;border:1px solid #f0b3cf;color:var(--sd-mag-d)}
${S} .notice svg{flex:none;margin-top:2px}
${S} .notice strong{display:block;font-size:14px;margin-bottom:2px;color:var(--sd-ink)}
${S} .notice code{font:500 12px var(--sd-mono);color:var(--sd-ink)}
${S} .howto{padding:26px 32px 8px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}
${S} .howto div{display:flex;flex-direction:column;gap:6px;padding-top:12px;border-top:1px solid var(--sd-ink)}
${S} .howto b{font:500 12px var(--sd-mono);color:var(--sd-cyan-d)}
${S} .howto strong{font-size:14px}
${S} .hostnote{margin:18px 32px 0;padding:14px 16px;background:var(--sd-wash);border-radius:2px;display:flex;gap:12px;align-items:flex-start}
${S} .hostnote svg{flex:none;margin-top:2px;color:#006786}
${S} .hostnote code{font:500 12px var(--sd-mono);background:#fff;padding:1px 5px;border:1px solid var(--sd-line-2);color:var(--sd-ink)}
${S} .group-t{margin:28px 32px 10px;display:flex;align-items:baseline;justify-content:space-between;gap:12px}
${S} .group-t span{font-size:12px;color:var(--sd-mute)}
${S} .rt{margin:0 32px;border:1px solid var(--sd-line-2);border-radius:2px}
${S} .rt-row{display:grid;grid-template-columns:120px 240px minmax(0,1fr) 164px}
${S} .rt-item{border-top:1px solid var(--sd-line-2)}
${S} .rt-h{background:var(--sd-wash)}
${S} .rt-h > div{padding:11px 16px;font:500 10px var(--sd-sans);letter-spacing:.08em;text-transform:uppercase;color:var(--sd-mute)}
${S} .rt-c{padding:16px;min-width:0;display:flex;flex-direction:column;gap:6px}
${S} .rt-c.row2{flex-direction:row;align-items:flex-start;justify-content:space-between;gap:10px}
${S} .type{font:600 12px var(--sd-mono);color:var(--sd-ink)}
${S} .purpose{color:var(--sd-mute);line-height:1.35}
${S} code.v{font:400 12.5px/1.55 var(--sd-mono);color:var(--sd-ink);word-break:break-all;white-space:pre-wrap;min-width:0;flex:1;padding-top:12px}
${S} code.h{font:500 13px/1.4 var(--sd-mono);color:var(--sd-ink);overflow-wrap:anywhere;flex:1;padding-top:12px}
${S} .prio{color:var(--sd-mute)}
${S} .prio code{font:500 12px var(--sd-mono);color:var(--sd-ink)}
${S} .copy{min-height:44px;min-width:64px;padding:0 10px;flex:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--sd-line);border-radius:2px;background:#fff;color:var(--sd-ink);font:500 12px var(--sd-sans);cursor:pointer}
${S} .copy:hover{border-color:var(--sd-ink)}
${S} .copy.done{border-color:var(--sd-cyan);color:#006786;background:var(--sd-cyan-w)}
${S} .rt-detail{margin:0 16px 16px;padding:12px 14px;background:var(--sd-wash);border-radius:2px;display:flex;gap:10px;align-items:flex-start;color:var(--sd-mag-d)}
${S} .rt-detail p{color:var(--sd-ink-2);min-width:0;overflow-wrap:anywhere}
${S} .notice > div,${S} .hostnote p,${S} .caution span{min-width:0;overflow-wrap:anywhere}
${S} .rt-detail svg{flex:none;margin-top:2px}
${S} .rcards{display:none;flex-direction:column;margin:0 16px}
${S} .rc{border:1px solid var(--sd-line-2);border-radius:2px;background:#fff;margin-bottom:14px}
${S} .rc-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--sd-line-2);background:var(--sd-wash)}
${S} .rc-h div{display:flex;flex-direction:column;gap:2px}
${S} .rc-b{padding:14px 16px;display:flex;flex-direction:column;gap:14px}
${S} .rc-kv{display:flex;flex-direction:column;gap:6px}
${S} .rc-line{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
${S} .rc code.v{padding:12px;background:var(--sd-wash);border-radius:2px;display:block}
${S} .rc .copy.wide{width:100%}
${S} .dmarc-sec{margin:32px 32px 0;padding-top:26px;border-top:1px solid var(--sd-line-2)}
${S} .dm-row{margin-top:18px;border:1px solid var(--sd-line-2);border-radius:2px;display:grid;grid-template-columns:128px 230px minmax(0,1fr)}
${S} .dm-row > div{padding:14px 16px;min-width:0;display:flex;gap:10px;align-items:flex-start;justify-content:space-between}
${S} .dm-row .type{padding-top:14px}
${S} .caution{margin-top:14px;display:flex;gap:10px;align-items:flex-start;color:var(--sd-ink-2);line-height:1.55}
${S} .caution svg{flex:none;margin-top:2px;color:var(--sd-mag-d)}
${S} .found{margin-top:14px;padding:14px 16px;background:var(--sd-cyan-w);border-radius:2px;display:flex;flex-direction:column;gap:6px}
${S} .found code{font:500 13px var(--sd-mono);color:var(--sd-cyan-dd);word-break:break-all}
${S} .vfoot{margin:30px 32px 0;padding-top:24px;border-top:1px solid var(--sd-line);display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
${S} .added{position:relative;display:inline-flex;align-items:center;gap:12px;min-height:44px;font-size:15px;color:var(--sd-ink);cursor:pointer}
${S} .added input{position:absolute;left:0;top:50%;width:22px;height:22px;margin:-11px 0 0;opacity:0;cursor:pointer}
${S} .added .box{width:22px;height:22px;flex:none;display:grid;place-items:center;border:1.5px solid var(--sd-mute-2);border-radius:3px;background:#fff;color:transparent}
${S} .added input:checked + .box{background:var(--sd-cyan);border-color:var(--sd-cyan);color:#fff}
${S} .added input:focus-visible + .box{box-shadow:0 0 0 3px #99e0ff}
${S} .vfoot-r{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
${S} .vnote{margin:6px 32px 0;padding-bottom:30px;font-size:13px;color:var(--sd-mute)}
${S} .okmark{width:56px;height:56px;border-radius:50%;background:var(--sd-cyan);color:#fff;display:grid;place-items:center;margin-bottom:18px}
${S} .metagrid{margin:28px 0 0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--sd-ink)}
${S} .metagrid div{padding:14px 16px 0 0;display:flex;flex-direction:column;gap:6px;min-width:0}
${S} .metagrid dt{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--sd-mute-2)}
${S} .metagrid dd{margin:0;font-size:14px;font-weight:500;word-break:break-word}
${S} .next{background:var(--sd-ink);color:#fff;border-radius:2px;padding:34px 40px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:end}
${S} .next .eyebrow{color:#99e0ff}
${S} .next h3{color:#fff;font-size:28px;margin:10px 0}
${S} .next p{color:var(--sd-line)}
${S} .fromprev{margin-top:18px;padding:12px 14px;border:1px solid var(--sd-ink-2);border-radius:2px;font:500 14px var(--sd-mono);color:#fff;word-break:break-all}
${S} .vhead{padding:24px 32px 6px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
${S} .vlist{padding:8px 32px 20px}
${S} .vrow{display:grid;grid-template-columns:80px minmax(0,1fr) auto;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--sd-line-2)}
${S} .vrow:first-child{border-top:0}
${S} .vrow code{font:500 13px var(--sd-mono);word-break:break-all}
${S} .danger-zone{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:24px 32px}
${S} .danger-zone strong{font-size:14px;display:block;margin-bottom:2px}
${S} .scrim{position:fixed;inset:0;background:rgb(32 30 29 / 62%);display:flex;justify-content:center;align-items:flex-start;padding:160px 20px 20px;z-index:50;overflow-y:auto}
${S} .dialog{width:min(520px,100%);background:#fff;border:1px solid var(--sd-line);box-shadow:0 22px 70px rgb(0 0 0 / 24%)}
${S} .dialog header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 24px 18px;border-bottom:1px solid var(--sd-line-2)}
${S} .dialog header h2{font-size:26px;margin:4px 0 0;word-break:break-word}
${S} .dialog .x{width:44px;height:44px;flex:none;border:1px solid var(--sd-line);background:#fff;color:var(--sd-ink);font-size:22px;line-height:1;cursor:pointer;border-radius:2px}
${S} .dialog .body{padding:20px 24px;display:flex;flex-direction:column;gap:16px}
${S} .dl{border-top:1px solid var(--sd-line-2)}
${S} .dl div{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--sd-line-2);font-size:13px}
${S} .dl span{color:var(--sd-mute)}
${S} .dl code{font:500 13px var(--sd-mono);text-align:right;word-break:break-all}
${S} .dialog footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px 22px;flex-wrap:wrap}

@media (max-width:1080px){
  ${S} .grid{grid-template-columns:minmax(0,1fr) 260px;gap:28px}
  ${S} .pad{padding:32px}
  ${S} .rt-row{grid-template-columns:92px 200px minmax(0,1fr) 150px}
  ${S} .rt-c{padding:16px 12px}
  ${S} .pill{letter-spacing:.08em}
  ${S} .metagrid{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:14px}
}
@media (max-width:860px){
  ${S} .grid{grid-template-columns:minmax(0,1fr)}
}
@media (max-width:760px){
  ${S} .rt{display:none}
  ${S} .rcards{display:flex;margin:0 32px}
  ${S} .dm-row{grid-template-columns:minmax(0,1fr)}
  ${S} .dm-row > div + div{border-top:1px solid var(--sd-line-2)}
  ${S} .dm-row .type{padding-top:0}
}
@media (max-width:640px){
  ${S}.nomi-flow-page{padding:20px 16px 56px}
  ${S} h1{font-size:34px}
  ${S} .steps li{flex-direction:column;gap:2px;font-size:12px}
  ${S} .pad{padding:26px 20px}
  ${S} h2{font-size:24px;overflow-wrap:anywhere}
  ${S} .dom{font-size:22px}
  ${S} .summary{flex-direction:column;align-items:flex-start;padding:22px 20px}
  ${S} .sum-r{align-items:flex-start}
  ${S} .notice{margin:20px 16px 0}
  ${S} .howto{grid-template-columns:minmax(0,1fr);padding:22px 20px 4px;gap:14px}
  ${S} .hostnote{margin:16px 16px 0}
  ${S} .group-t{margin:24px 16px 10px;flex-direction:column;gap:2px}
  ${S} .rcards{margin:0 16px}
  ${S} .dmarc-sec{margin:24px 16px 0}
  ${S} .vfoot{margin:24px 16px 0;flex-direction:column;align-items:stretch}
  ${S} .vfoot-r .btn{width:100%}
  ${S} .vnote{margin:8px 16px 0}
  ${S} .metagrid{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:14px}
  ${S} .next{grid-template-columns:minmax(0,1fr);padding:26px 20px}
  ${S} .next .btn{width:100%}
  ${S} .vhead{flex-direction:column;padding:22px 20px 6px}
  ${S} .vlist{padding:8px 20px 16px}
  ${S} .vrow{grid-template-columns:56px minmax(0,1fr);row-gap:8px}
  ${S} .vrow .pill{grid-column:2}
  ${S} .danger-zone{flex-direction:column;align-items:stretch;padding:22px 20px}
  ${S} .scrim{padding:72px 16px 16px}
  ${S} .dialog footer .btn{flex:1}
}
`;
