const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('HTMLから参照するローカルCSS・JS・画像がすべて存在する', () => {
    for(const file of ['index.html', 'credit.html']) {
        const html = fs.readFileSync(path.join(root, file), 'utf8');
        const refs = [...html.matchAll(/\s(?:src|href)="([^"#?]+)"/g)]
            .map(match => match[1])
            .filter(ref => !/^(?:https?:|data:|mailto:)/.test(ref));
        for(const ref of refs) {
            assert.ok(fs.existsSync(path.join(root, ref)), `${file}: ${ref} が見つかりません`);
        }
    }
});

test('リリース対象JavaScriptは構文エラーなしで読み込める', () => {
    const source = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
    assert.doesNotThrow(() => new Function(source));
});
