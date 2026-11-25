/**
 * The store pack (docs/store/) is what Matt pastes into Play Console and App
 * Store Connect, and its public pages go live on the web. It must describe
 * the app as merged. Chat groups (#294 to #299) let members post back and
 * forth, so the pack may no longer say there are no replies or that only
 * staff send messages, and it must say how chat groups keep children safe.
 */
const { existsSync, readFileSync, readdirSync } = jest.requireActual('fs') as {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string): string[];
};

const read = (file: string) => readFileSync(`docs/store/${file}`, 'utf8');
const migrations = readdirSync('supabase/migrations');
const chatGroupsMerged = migrations.some((f) => /_chat_groups\.sql$/.test(f));

const quoted = [
  'play-listing.md',
  'play-app-content.md',
  'play-data-safety.md',
  'review-notes.md',
  'data-inventory.md',
  'public-pages/privacy.md',
  'public-pages/support.md',
  'public-pages/delete-account.md',
];

// Claims that stopped being true when chat groups merged.
const outdated = [
  /\bno (direct messages and no )?replies\b/i,
  /direct messages, replies/i,
  /\bor reply to messages\b/i,
  /there are no replies/i,
  /group messages only/i,
];

describe('the store pack', () => {
  it('knows chat groups are merged', () => {
    expect(chatGroupsMerged).toBe(true);
  });

  it.each(quoted)('%s makes no claim chat groups made untrue', (file) => {
    const text = read(file);
    for (const claim of outdated) {
      expect({ file, claim: String(claim), found: claim.exec(text)?.[0] ?? null }).toEqual({
        file,
        claim: String(claim),
        found: null,
      });
    }
  });

  it.each(['play-listing.md', 'play-app-content.md', 'review-notes.md', 'public-pages/privacy.md'])(
    '%s says chat groups are coach-led for under 18s and copied to parents',
    (file) => {
      const text = read(file).replace(/\s+/g, ' ');
      expect(text).toMatch(/chat groups?/i);
      expect(text).toMatch(/coach/i);
      expect(text).toMatch(/under 18/i);
      expect(text).toMatch(/parents? gets? a copy|copied to (the child's verified )?parents/i);
    },
  );

  it('lists chat group posts and their tables in the data inventory', () => {
    const row12 = read('data-inventory.md')
      .split('\n')
      .find((line) => line.startsWith('| 12 |'));
    expect(row12).toBeDefined();
    for (const table of ['`messages`', '`message_recipients`', '`chat_groups`', '`chat_group_hidden`']) {
      expect(row12).toContain(table);
    }
    expect(row12).toMatch(/chat group posts/i);
  });

  it('names only migrations that exist', () => {
    for (const file of quoted.concat('README.md')) {
      for (const [, name] of read(file).matchAll(/`(\d{14}_[a-z0-9_]+\.sql)`/g)) {
        expect({ file, name, exists: existsSync(`supabase/migrations/${name}`) }).toEqual({
          file,
          name,
          exists: true,
        });
      }
    }
  });

  it('keeps the Play listing within Google’s lengths', () => {
    const listing = read('play-listing.md');
    const quote = (heading: string) => {
      const after = listing.split(heading)[1];
      const lines = after.split('\n');
      const start = lines.findIndex((l) => l.startsWith('>'));
      const block: string[] = [];
      for (const line of lines.slice(start)) {
        if (!line.startsWith('>')) break;
        block.push(line.replace(/^> ?/, ''));
      }
      return block.join('\n').trim();
    };
    const short = quote('**Short description**').replace(/ \(\d+\)$/, '');
    expect(short.length).toBeLessThanOrEqual(80);
    expect(quote('**Full description**').length).toBeLessThanOrEqual(4000);
  });

  it('dates the privacy page', () => {
    expect(read('public-pages/privacy.md')).toMatch(
      /^Last updated: \d{1,2} (January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/m,
    );
  });
});
