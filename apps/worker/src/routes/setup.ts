import { Hono } from 'hono';
import type { Env } from '../index.js';

const setup = new Hono<Env>();

setup.get('/setup', (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LINE Harness 導入ガイド</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', system-ui, sans-serif;
    color: #24292f;
    background: #ffffff;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }

  /* Header */
  .header {
    background: #0d1117;
    color: #ffffff;
    padding: 2rem 1.5rem;
    text-align: center;
  }
  .header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  .header p {
    margin-top: 0.5rem;
    color: #8b949e;
    font-size: 0.95rem;
  }

  /* Container */
  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  /* Tabs */
  .tab-bar {
    display: flex;
    border-bottom: 2px solid #e1e4e8;
    margin-bottom: 2rem;
  }
  .tab-btn {
    flex: 1;
    padding: 0.85rem 1rem;
    background: none;
    border: none;
    font-size: 1rem;
    font-weight: 600;
    font-family: inherit;
    color: #57606a;
    cursor: pointer;
    border-bottom: 3px solid transparent;
    margin-bottom: -2px;
    transition: color 0.2s, border-color 0.2s;
  }
  .tab-btn:hover { color: #24292f; }
  .tab-btn.active {
    color: #06C755;
    border-bottom-color: #06C755;
  }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Steps */
  .step {
    margin-bottom: 2rem;
    padding: 1.5rem;
    border: 1px solid #e1e4e8;
    border-radius: 12px;
    background: #fafbfc;
  }
  .step-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background: #06C755;
    color: #ffffff;
    font-weight: 700;
    font-size: 0.9rem;
    margin-right: 0.75rem;
    flex-shrink: 0;
  }
  .step-header {
    display: flex;
    align-items: center;
    margin-bottom: 0.75rem;
  }
  .step-title {
    font-size: 1.1rem;
    font-weight: 700;
  }
  .step-body {
    color: #57606a;
    font-size: 0.95rem;
  }
  .step-body p { margin-bottom: 0.5rem; }
  .step-body a {
    color: #06C755;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .step-body a:hover { color: #05a847; }

  /* Terminal */
  .terminal {
    background: #0d1117;
    color: #3fb950;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.9rem;
    padding: 1rem 1.25rem;
    border-radius: 8px;
    margin-top: 0.75rem;
    overflow-x: auto;
    white-space: pre;
    line-height: 1.6;
  }

  /* kbd */
  kbd {
    display: inline-block;
    padding: 0.15em 0.45em;
    font-size: 0.85em;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    color: #24292f;
    background: #f0f2f4;
    border: 1px solid #d0d3d7;
    border-radius: 5px;
    box-shadow: inset 0 -1px 0 #d0d3d7;
    line-height: 1;
    vertical-align: baseline;
  }

  /* Command box */
  .command-section {
    margin-top: 2.5rem;
    text-align: center;
  }
  .command-section h2 {
    font-size: 1.2rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }
  .command-box {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    max-width: 480px;
    margin: 0 auto;
  }
  .command-preview {
    flex: 1;
    background: #0d1117;
    color: #3fb950;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 1rem;
    padding: 0.9rem 1.25rem;
    border-radius: 8px;
    text-align: left;
    white-space: nowrap;
    overflow-x: auto;
    min-width: 0;
  }
  .copy-btn {
    flex-shrink: 0;
    padding: 0.9rem 1.5rem;
    background: #06C755;
    color: #ffffff;
    border: none;
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.2s;
    white-space: nowrap;
  }
  .copy-btn:hover { background: #05a847; }
  .copy-btn:active { transform: scale(0.97); }
  .copy-feedback {
    margin-top: 0.5rem;
    font-size: 0.85rem;
    color: #06C755;
    font-weight: 600;
    min-height: 1.3em;
  }

  /* Note */
  .note {
    background: #fff8e1;
    border-left: 4px solid #f9a825;
    padding: 0.75rem 1rem;
    border-radius: 0 8px 8px 0;
    margin-top: 0.75rem;
    font-size: 0.9rem;
    color: #5d4e00;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .header h1 { font-size: 1.35rem; }
    .container { padding: 1.5rem 1rem 3rem; }
    .step { padding: 1.25rem; }
    .command-box { flex-direction: column; }
    .command-preview { width: 100%; text-align: center; }
    .copy-btn { width: 100%; }
  }
</style>
</head>
<body>
  <div class="header">
    <h1>LINE Harness 導入ガイド</h1>
    <p>3ステップで LINE CRM を構築</p>
  </div>

  <div class="container">
    <div class="tab-bar">
      <button class="tab-btn active" data-tab="windows" onclick="switchTab('windows')">Windows</button>
      <button class="tab-btn" data-tab="mac" onclick="switchTab('mac')">Mac</button>
    </div>

    <!-- Windows -->
    <div id="tab-windows" class="tab-content active">
      <div class="step">
        <div class="step-header">
          <span class="step-number">1</span>
          <span class="step-title">Node.js インストール</span>
        </div>
        <div class="step-body">
          <p><a href="https://nodejs.org/ja" target="_blank" rel="noopener">Node.js 公式サイト</a>を開き、「Node.js を入手」ボタンを押してインストーラーをダウンロードしてください。</p>
          <p>ダウンロードしたファイルを実行し、画面の指示に従って進めればOKです。</p>
        </div>
      </div>

      <div class="step">
        <div class="step-header">
          <span class="step-number">2</span>
          <span class="step-title">Git インストール</span>
        </div>
        <div class="step-body">
          <p><a href="https://git-scm.com/downloads/win" target="_blank" rel="noopener">Git for Windows</a> を開き、「Click here to download」をクリックしてください。</p>
          <p>インストーラーを実行したら <kbd>Next</kbd> を連打するだけでOKです。</p>
        </div>
      </div>

      <div class="step">
        <div class="step-header">
          <span class="step-number">3</span>
          <span class="step-title">コマンド実行</span>
        </div>
        <div class="step-body">
          <p><kbd>Win</kbd>+<kbd>R</kbd> を押して「ファイル名を指定して実行」を開き、<kbd>cmd</kbd> と入力して <kbd>Enter</kbd> を押します。</p>
          <p>黒い画面（コマンドプロンプト）が開いたら、下のコマンドをコピーして<strong>右クリック</strong>で貼り付け、<kbd>Enter</kbd> で実行してください。</p>
          <div class="note">⚠️ <strong>PowerShell ではなく「コマンドプロンプト（cmd）」を使ってください。</strong>PowerShell では <kbd>@</kbd> が特殊文字として扱われ、エラーになります。</div>
        </div>
      </div>
    </div>

    <!-- Mac -->
    <div id="tab-mac" class="tab-content">
      <div class="step">
        <div class="step-header">
          <span class="step-number">1</span>
          <span class="step-title">ターミナルを開く</span>
        </div>
        <div class="step-body">
          <p><strong>Finder</strong> → <strong>アプリケーション</strong> → <strong>ユーティリティ</strong> → <strong>ターミナル</strong> を開いてください。</p>
        </div>
      </div>

      <div class="step">
        <div class="step-header">
          <span class="step-number">2</span>
          <span class="step-title">Git + Node.js インストール</span>
        </div>
        <div class="step-body">
          <p>以下の2つのコマンドを順番にコピー＆ペーストして実行してください。</p>
          <div class="terminal">$ xcode-select --install</div>
          <div class="terminal">$ curl -fsSL https://fnm.vercel.app/install | bash &amp;&amp; fnm install --lts</div>
          <div class="note">パスワード入力を求められた場合、キーを押しても画面には何も表示されませんが、入力はされています。そのまま打ち込んで <kbd>Enter</kbd> を押してください。</div>
        </div>
      </div>

      <div class="step">
        <div class="step-header">
          <span class="step-number">3</span>
          <span class="step-title">コマンド実行</span>
        </div>
        <div class="step-body">
          <p>下のコマンドをコピーして、ターミナルに <kbd>&#8984;</kbd>+<kbd>V</kbd> で貼り付け、<kbd>Enter</kbd> で実行してください。</p>
        </div>
      </div>
    </div>

    <!-- Common command box -->
    <div class="command-section">
      <h2>実行コマンド</h2>
      <div class="command-box">
        <div class="command-preview">$ npx create-line-harness@latest</div>
        <button class="copy-btn" onclick="copyCommand()">コピー</button>
      </div>
      <div class="copy-feedback" id="copy-feedback"></div>
    </div>
  </div>

<script>
function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.tab-content').forEach(function(content) {
    content.classList.toggle('active', content.id === 'tab-' + tab);
  });
}

function copyCommand() {
  var command = 'npx create-line-harness@latest';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(command).then(function() {
      showFeedback();
    });
  } else {
    var textarea = document.createElement('textarea');
    textarea.value = command;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showFeedback();
  }
}

function showFeedback() {
  var el = document.getElementById('copy-feedback');
  el.textContent = 'コピーしました！';
  setTimeout(function() { el.textContent = ''; }, 2000);
}
</script>
</body>
</html>`);
});

export { setup };
