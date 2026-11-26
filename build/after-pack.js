const fs = require('node:fs');
const path = require('node:path');

// 只保留中英文，其余本地化资源在 dmg 里会白占十几 MB。
const KEEP = new Set(['en', 'zh_CN', 'zh-CN', 'Base']);

function dirSize(target) {
  let total = 0;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        try {
          total += fs.statSync(full).size;
        } catch (error) {
          // 统计失败不影响清理
        }
      }
    }
  }
  return total;
}

function pruneLocales(root) {
  let removed = 0;
  let freed = 0;

  const walk = dir => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith('.lproj')) {
        const locale = entry.name.slice(0, -'.lproj'.length);
        if (KEEP.has(locale)) continue;
        freed += dirSize(full);
        fs.rmSync(full, { recursive: true, force: true });
        removed += 1;
        continue;
      }
      walk(full);
    }
  };

  walk(root);
  return { removed, freed };
}

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;

  const appDir = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  const { removed, freed } = pruneLocales(appDir);
  console.log(
    `[after-pack] 清理 ${removed} 个语言目录，释放 ${(freed / 1048576).toFixed(1)} MiB`
  );
};
