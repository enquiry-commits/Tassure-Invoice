// Shared minimal markdown renderer for assistant replies — **bold**,
// [label](href) as clickable nav buttons, `· `/`-`/`•` bullets, and (added
// 2026-09-09) markdown tables. Pulled out of components/AssistantWidget.tsx
// (2026-09-08) so the new full-page chat on My Tasks (app/my-tasks/page.tsx)
// renders assistant messages identically to the floating widget, instead of
// a second, potentially drifting copy of the same handful of rendering rules.
//
// Table rendering added after Vincent screenshotted a real preview reply's
// "本期待开单的服务" table rendering as raw, unparsed `| a | b |` / `|---|---|`
// text — this renderer never handled tables at all, it just fell through to
// the generic plain-line branch. He also shared a reference screenshot (a
// navy-header, clean-grid HTML table) and asked that its look become the
// STANDARD framework for any future chart/table-like content in chat, not a
// one-off fix — MarkdownTable below is that shared style, styled to match
// the rest of the app's own navy-header convention (e.g. the modal headers
// in app/billing/page.tsx) rather than inventing a new palette.
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

// The one shared table look — reused for every markdown table an assistant
// reply produces (a services table today, but deliberately generic: any
// future |a|b|c| content gets this same navy-header/clean-grid treatment,
// per Vincent's explicit request not to design a one-off).
function MarkdownTable({ header, rows, onNav }: { header: string[]; rows: string[][]; onNav: (href: string) => void }) {
  return (
    <div style={{ margin: '10px 0', border: '1px solid #d7e1eb', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 380 }}>
          <thead>
            <tr style={{ background: '#1d3a5c' }}>
              {header.map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '9px 13px', color: '#fff', fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap' }}>
                  <Inline text={h} onNav={onNav} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} style={{ background: '#fff' }}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    style={{
                      padding: '9px 13px',
                      color: ci === 0 ? '#173b61' : '#334155',
                      fontWeight: ci === 0 ? 700 : 500,
                      borderTop: '1px solid #eef2f7',
                      verticalAlign: 'top',
                    }}
                  >
                    <Inline text={cell} onNav={onNav} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// A markdown table separator row (`|---|:---:|---|`, or the equally valid
// GFM form without outer pipes, `---|---|---`) — cells are only
// dashes/colons/whitespace. Real header/body rows never match this, so this
// (not "does the line have outer pipes") is the actual signal a table
// starts — Claude doesn't always emit the outer pipes consistently.
function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return false;
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
  return cells.length > 0 && cells.every(c => /^:?-+:?$/.test(c));
}
function looksLikeTableRow(line: string): boolean {
  return line.trim().includes('|');
}
function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
}

export function RichText({ text, onNav }: { text: string; onNav: (href: string) => void }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trimEnd();

    if (!line.trim()) {
      // More vertical room than the original 8px — Vincent, 2026-09-09:
      // "目前输出内容太紧凑了，能不能优化UI排版" (the output feels too
      // cramped). Blank lines are the main paragraph/section separator a
      // reply's own text uses, so this is the single highest-leverage
      // spacing knob.
      elements.push(<div key={i} style={{ height: 14 }} />);
      continue;
    }

    // Markdown table: this line looks like a row AND the next line is a
    // real separator row — never guess a table from a single stray `|`.
    if (looksLikeTableRow(line) && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1])) {
      const header = parseTableRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && looksLikeTableRow(lines[j])) {
        rows.push(parseTableRow(lines[j]));
        j++;
      }
      elements.push(<MarkdownTable key={i} header={header} rows={rows} onNav={onNav} />);
      i = j - 1;
      continue;
    }

    const noLinks = line.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/[·・\s]/g, '');
    const hasLink = /\[[^\]]+\]\([^)]+\)/.test(line);
    if (hasLink && (noLinks === '' || /^快捷入口[::]?$/.test(noLinks))) {
      elements.push(
        <div key={i} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '4px 0 2px' }}>
          <Inline text={line} onNav={onNav} />
        </div>,
      );
      continue;
    }

    const bullet = line.match(/^[·\-•]\s*(.*)$/);
    if (bullet) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: 7, margin: '4px 0', paddingLeft: 2 }}>
          <span style={{ color: '#0f766e', flexShrink: 0, lineHeight: 1.55 }}>•</span>
          <span style={{ flex: 1 }}><Inline text={bullet[1]} onNav={onNav} /></span>
        </div>,
      );
      continue;
    }

    if (/^\*\*[^*]+\*\*$/.test(line.trim())) {
      elements.push(
        <div
          key={i}
          style={{
            fontSize: 13.5,
            fontWeight: 750,
            color: '#12233b',
            margin: elements.length === 0 ? '0 0 6px' : '16px 0 6px',
            paddingBottom: 5,
            borderBottom: '1px solid #eef2f6',
          }}
        >
          {line.trim().slice(2, -2)}
        </div>,
      );
      continue;
    }

    elements.push(
      <div key={i} style={{ margin: '5px 0' }}>
        <Inline text={line} onNav={onNav} />
      </div>,
    );
  }

  return <div style={{ display: 'flex', flexDirection: 'column' }}>{elements}</div>;
}
