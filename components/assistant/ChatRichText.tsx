// Shared minimal markdown renderer for assistant replies — **bold**,
// [label](href) as clickable nav buttons, and `· `/`-`/`•` bullets. Pulled
// out of components/AssistantWidget.tsx (2026-09-08) so the new full-page
// chat on My Tasks (app/my-tasks/page.tsx) renders assistant messages
// identically to the floating widget, instead of a second, potentially
// drifting copy of the same handful of rendering rules.
export function Inline({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const [, label, href] = link;
          return (
            <button
              key={index}
              onClick={() => onNav(href)}
              style={{
                display: 'inline-block',
                margin: 2,
                padding: '4px 11px',
                borderRadius: 999,
                border: '1px solid #99f6e4',
                background: '#f0fdfa',
                color: '#0f766e',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {label} →
            </button>
          );
        }
        const bold = part.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={index} style={{ color: '#12233b', fontWeight: 750 }}>{bold[1]}</strong>;
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function RichText({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const lines = text.split('\n');
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={index} style={{ height: 8 }} />;

        const noLinks = line.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[·・\s]/g, '');
        const hasLink = /\[[^\]]+\]\([^)]+\)/.test(line);
        if (hasLink && (noLinks === '' || /^快捷入口[::]?$/.test(noLinks))) {
          return (
            <div key={index} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
              <Inline text={line} onNav={onNav} />
            </div>
          );
        }

        const bullet = line.match(/^[·\-•]\s*(.*)$/);
        if (bullet) {
          return (
            <div key={index} style={{ display: 'flex', gap: 7, margin: '2.5px 0', paddingLeft: 2 }}>
              <span style={{ color: '#0f766e', flexShrink: 0, lineHeight: 1.55 }}>•</span>
              <span style={{ flex: 1 }}><Inline text={bullet[1]} onNav={onNav} /></span>
            </div>
          );
        }

        if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
          return (
            <div
              key={index}
              style={{
                fontSize: 13,
                fontWeight: 750,
                color: '#12233b',
                margin: index === 0 ? '0 0 4px' : '6px 0 4px',
                paddingBottom: 4,
                borderBottom: '1px solid #eef2f6',
              }}
            >
              {line.trim().slice(2, -2)}
            </div>
          );
        }

        return (
          <div key={index} style={{ margin: '2px 0' }}>
            <Inline text={line} onNav={onNav} />
          </div>
        );
      })}
    </div>
  );
}
