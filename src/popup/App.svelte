<script lang="ts">
  import { onMount } from 'svelte'
  import type { SerializableTimeline } from '$lib/types'
  import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '$lib/settings'
  import type { MoodlineSettings } from '$lib/settings'

  const COMPONENT_LABELS: Record<string, string> = {
    mod_quiz: 'クイズ', mod_assign: '課題',
    mod_questionnaire: 'アンケート', mod_forum: 'フォーラム', mod_choice: '投票',
  }

  let timelines: SerializableTimeline[] = $state([])
  let status: 'loading' | 'ok' | 'no-moodle' | 'no-data' = $state('loading')
  let tab: 'list' | 'settings' = $state('list')
  let settings: MoodlineSettings = $state({ ...DEFAULT_SETTINGS })
  let saved = $state(false)

  function label(comp: string) { return COMPONENT_LABELS[comp] ?? comp.replace('mod_', '') }
  function fmt(ts?: number) {
    if (!ts) return '?'
    const d = new Date(ts * 1000)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  function startTs(tl: SerializableTimeline) { return tl.openTs ?? tl.dueTs }
  function endTs(tl: SerializableTimeline)   { return tl.closeTs ?? tl.dueTs }

  async function onSave() {
    await saveSettings(settings)
    saved = true
    setTimeout(() => saved = false, 1800)
  }

  onMount(async () => {
    // 設定を読む
    const s = await loadSettings()
    settings = { ...s, statusColors: { ...s.statusColors } }

    // タイムラインを取る
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) { status = 'no-moodle'; return }
      const resp = await chrome.tabs.sendMessage(tab.id, { type: 'GET_TIMELINES' }).catch(() => null)
      if (!resp) { status = 'no-moodle'; return }
      timelines = resp.timelines ?? []
      status = timelines.length ? 'ok' : 'no-data'
    } catch {
      status = 'no-moodle'
    }
  })
</script>

<div class="root">
  <!-- Header -->
  <header class="hdr">
    <div class="logo">ML</div>
    <div>
      <h1 class="title">Moodline</h1>
      <p class="sub">Moodle カレンダー拡張</p>
    </div>
  </header>

  <!-- Tabs -->
  <div class="tabs">
    <button class="tab" class:active={tab === 'list'}     onclick={() => tab = 'list'}>課題一覧</button>
    <button class="tab" class:active={tab === 'settings'} onclick={() => tab = 'settings'}>設定</button>
  </div>

  <!-- Timeline list -->
  {#if tab === 'list'}
    <section class="section">
      <p class="notice">表示は目安です。提出前・受験前に Moodle 本体で最終確認してください。</p>
      {#if status === 'loading'}
        <p class="hint">読み込み中...</p>
      {:else if status === 'no-moodle'}
        <p class="hint">Moodle のダッシュボードを開いてください</p>
      {:else if status === 'no-data'}
        <p class="hint">カレンダーに課題が見つかりませんでした</p>
      {:else}
        <div class="list">
          {#each timelines as tl}
            {@const barColor =
              settings.colorMode === 'by-status'
                ? (tl.completion === 'completed' ? settings.statusColors.completed
                  : tl.completion === 'incomplete' ? settings.statusColors.incomplete
                  : settings.statusColors.unknown)
                : tl.color}
            <div class="card" style="border-left-color:{barColor}">
              <div class="card-row">
                <span class="card-name" title={tl.name}>{tl.name}</span>
                {#if tl.completion === 'completed'}
                  <span class="badge badge-done">完了</span>
                {:else if tl.completion === 'incomplete'}
                  <span class="badge badge-todo">未完了</span>
                {/if}
              </div>
              <div class="card-meta">
                <span class="card-type">{label(tl.component)}</span>
                <span class="sep">·</span>
                <span class="card-dates">{fmt(startTs(tl))} → {fmt(endTs(tl))}</span>
              </div>
              <div class="bar-bg" style="background:{barColor}22">
                <div class="bar-fill" style="background:{barColor}"></div>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

  <!-- Settings -->
  {:else}
    <section class="section">
      <div class="setting-group">
        <p class="setting-label">色分けモード</p>
        <div class="radio-group">
          <label class="radio">
            <input type="radio" name="mode" value="by-assignment"
              checked={settings.colorMode === 'by-assignment'}
              onchange={() => settings.colorMode = 'by-assignment'} />
            <span>課題別（固定カラー）</span>
          </label>
          <label class="radio">
            <input type="radio" name="mode" value="by-status"
              checked={settings.colorMode === 'by-status'}
              onchange={() => settings.colorMode = 'by-status'} />
            <span>進捗別</span>
          </label>
        </div>
      </div>

      {#if settings.colorMode === 'by-status'}
        <div class="setting-group">
          <p class="setting-label">進捗別カラー</p>
          <div class="color-rows">
            <div class="color-row">
              <div class="status-dot" style="background:{settings.statusColors.completed}"></div>
              <span class="color-name">完了</span>
              <input class="color-input" type="color"
                value={settings.statusColors.completed}
                oninput={e => settings.statusColors.completed = (e.target as HTMLInputElement).value} />
              <span class="color-hex">{settings.statusColors.completed}</span>
            </div>
            <div class="color-row">
              <div class="status-dot" style="background:{settings.statusColors.incomplete}"></div>
              <span class="color-name">未完了</span>
              <input class="color-input" type="color"
                value={settings.statusColors.incomplete}
                oninput={e => settings.statusColors.incomplete = (e.target as HTMLInputElement).value} />
              <span class="color-hex">{settings.statusColors.incomplete}</span>
            </div>
            <div class="color-row">
              <div class="status-dot" style="background:{settings.statusColors.unknown}"></div>
              <span class="color-name">不明</span>
              <input class="color-input" type="color"
                value={settings.statusColors.unknown}
                oninput={e => settings.statusColors.unknown = (e.target as HTMLInputElement).value} />
              <span class="color-hex">{settings.statusColors.unknown}</span>
            </div>
          </div>
        </div>
      {/if}

      <div class="setting-group">
        <p class="setting-label">通常時バー透明度</p>
        <div class="opacity-wrap">
          <input
            class="opacity-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.barOpacity}
            oninput={e => settings.barOpacity = Number((e.target as HTMLInputElement).value)}
          />
          <span class="opacity-value">{settings.barOpacity.toFixed(2)}</span>
        </div>
        <p class="opacity-note">ホバー時は常に 1.00 で表示されます</p>
      </div>

      <button class="save-btn" onclick={onSave}>
        {saved ? '保存しました ✓' : '設定を保存'}
      </button>
    </section>
  {/if}

  <footer class="footer-links">
    <a
      class="github-link"
      href="https://github.com/shiki-01/moodline"
      target="_blank"
      rel="noreferrer"
    >
      GitHub で見る
    </a>
  </footer>
</div>

<style>
  :global(body) { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }

  .root { font-size:14px; padding:14px; width:280px; background:#fafafa; }

  .hdr { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
  .logo { width:28px;height:28px;background:#3b82f6;border-radius:6px;
    display:flex;align-items:center;justify-content:center;
    font-size:11px;font-weight:bold;color:#fff;flex-shrink:0; }
  .title { font-size:15px;font-weight:bold;margin:0;color:#111; }
  .sub { font-size:11px;color:#888;margin:0; }

  .tabs { display:flex;border-bottom:1px solid #e5e7eb;margin-bottom:12px; }
  .tab { flex:1;padding:6px 0;background:none;border:none;
    font-size:12px;font-weight:500;color:#888;cursor:pointer;
    border-bottom:2px solid transparent;transition:color .15s,border-color .15s; }
  .tab.active { color:#3b82f6;border-bottom-color:#3b82f6; }

  .hint { font-size:12px;color:#999;text-align:center;padding:16px 0;margin:0; }
  .notice {
    margin: 0 0 10px;
    padding: 8px 10px;
    font-size: 11px;
    color: #7c2d12;
    background: #fff7ed;
    border: 1px solid #fed7aa;
    border-radius: 7px;
    line-height: 1.45;
  }

  .list { display:flex;flex-direction:column;gap:7px;max-height:340px;overflow-y:auto; }
  .card { background:#fff;border-radius:8px;padding:9px 10px;
    box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:3px solid transparent; }
  .card-row { display:flex;align-items:center;justify-content:space-between;margin-bottom:3px; }
  .card-name { font-size:13px;font-weight:600;color:#222;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:165px; }
  .badge { font-size:10px;font-weight:bold;padding:1px 5px;border-radius:3px;flex-shrink:0; }
  .badge-done { background:#dcfce7;color:#15803d; }
  .badge-todo { background:#fef3c7;color:#b45309; }
  .card-meta { display:flex;align-items:center;gap:5px; }
  .card-type { font-size:10px;color:#888; }
  .sep { font-size:10px;color:#ccc; }
  .card-dates { font-size:10px;color:#666; }
  .bar-bg { margin-top:6px;height:4px;border-radius:2px;width:100%; }
  .bar-fill { height:4px;border-radius:2px;width:100%; }

  /* settings */
  .setting-group { margin-bottom:14px; }
  .setting-label { font-size:11px;font-weight:600;color:#555;
    text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px; }
  .radio-group { display:flex;flex-direction:column;gap:6px; }
  .radio { display:flex;align-items:center;gap:7px;cursor:pointer;font-size:13px;color:#333; }
  .radio input { accent-color:#3b82f6;width:14px;height:14px; }

  .color-rows { display:flex;flex-direction:column;gap:8px; }
  .color-row { display:flex;align-items:center;gap:8px; }
  .status-dot { width:10px;height:10px;border-radius:50%;flex-shrink:0; }
  .color-name { font-size:12px;color:#444;width:42px;flex-shrink:0; }
  .color-input { width:32px;height:24px;padding:0;border:1px solid #ddd;
    border-radius:4px;cursor:pointer;background:none; }
  .color-hex { font-size:10px;color:#999;font-family:monospace; }

  .save-btn { width:100%;padding:8px;background:#3b82f6;color:#fff;
    border:none;border-radius:7px;font-size:13px;font-weight:600;
    cursor:pointer;transition:background .15s; }
  .save-btn:hover { background:#2563eb; }

  .opacity-wrap { display:flex; align-items:center; gap:10px; }
  .opacity-slider { flex:1; accent-color:#3b82f6; }
  .opacity-value {
    font-size:11px;
    font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color:#555;
    width:38px;
    text-align:right;
  }
  .opacity-note { margin:6px 0 0; font-size:11px; color:#777; }

  .footer-links {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid #e5e7eb;
    text-align: center;
  }

  .github-link {
    font-size: 12px;
    color: #2563eb;
    text-decoration: none;
    font-weight: 500;
  }

  .github-link:hover {
    text-decoration: underline;
  }
</style>
