import Link from 'next/link';

const agentPrompt = `Use generate_wordmark_logo to create a modern horizontal wordmark for
"Kopi Nusantara", a premium Indonesian coffee brand. Use dark brown and gold.
Save the result as kopi-nusantara.svg.`;

const remoteConfig = `MCP URL: https://wordmarks-v2-dz1.pages.dev/mcp
Transport: Streamable HTTP
Header: Authorization: Bearer YOUR_WORDMARKS_TOKEN`;

const bridgeConfig = `{
  "type": "local",
  "command": [
    "npx.cmd", "-y", "mcp-remote",
    "https://wordmarks-v2-dz1.pages.dev/mcp",
    "--header", "Authorization: Bearer \${WORDMARKS_TOKEN}"
  ],
  "environment": { "WORDMARKS_TOKEN": "YOUR_TOKEN" },
  "timeout": 120000
}`;

export default function DevelopersPage() {
  return (
    <main className="min-h-screen bg-[#f2f0e9] text-[#171714]">
      <header className="border-b border-black/10 px-5 py-4 sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="text-xl font-black tracking-[-0.06em]">
            wordmarks<span className="text-[#ff5c35]">.</span>
          </Link>
          <Link href="/#create" className="rounded-full bg-[#171714] px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-white">
            Create a logo
          </Link>
        </div>
      </header>

      <section className="px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto max-w-7xl">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-[#5b42d5]">Developer platform</p>
          <h1 className="mt-4 max-w-5xl text-5xl font-black leading-[0.88] tracking-[-0.07em] sm:text-7xl lg:text-8xl">
            Give your AI agent a logo studio.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-black/55">
            Connect once, then generate editable SVG wordmarks from Codex, Kilo, Zcode, Claude Code, or any compatible MCP client.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {[
              ['01', 'Get access', 'Request a Wordmarks token from the administrator. Never use the PesatRouter key here.'],
              ['02', 'Connect MCP', 'Use Streamable HTTP directly, or mcp-remote when your agent only supports local stdio.'],
              ['03', 'Describe the logo', 'Ask naturally. The agent calls generate_wordmark_logo and receives an editable SVG.'],
            ].map(([number, title, copy]) => (
              <article key={number} className="rounded-[1.75rem] border border-black/10 bg-white/60 p-6">
                <span className="font-mono text-xs text-[#ff5c35]">{number}</span>
                <h2 className="mt-8 text-2xl font-black tracking-[-0.04em]">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-black/55">{copy}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#171714] px-5 py-16 text-white sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#c6ff4a]">Remote MCP</p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.055em]">For MCP-native agents</h2>
            <pre className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-xs leading-6 text-white/70"><code>{remoteConfig}</code></pre>
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-[#c6ff4a]">Local bridge</p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.055em]">For stdio-only agents</h2>
            <pre className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-xs leading-6 text-white/70"><code>{bridgeConfig}</code></pre>
          </div>
        </div>
      </section>

      <section className="bg-[#c6ff4a] px-5 py-16 sm:px-8 lg:py-24">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em]">Natural-language workflow</p>
            <h2 className="mt-4 text-5xl font-black leading-[0.9] tracking-[-0.065em]">No JSON on every request.</h2>
            <p className="mt-5 text-sm leading-6 text-black/55">Once connected, users simply describe the brand. The agent chooses the Wordmarks tool automatically.</p>
          </div>
          <pre className="overflow-x-auto rounded-[1.75rem] bg-[#171714] p-6 text-sm leading-7 text-white/75 shadow-xl"><code>{agentPrompt}</code></pre>
        </div>
      </section>

      <footer className="bg-[#171714] px-5 py-7 text-white sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between text-xs text-white/40">
          <span>Wordmarks Developer Platform</span>
          <span>SVG output · Token protected</span>
        </div>
      </footer>
    </main>
  );
}
