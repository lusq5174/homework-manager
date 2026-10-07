# 如何修改版本号

版本号分散在三个版本中，**必须三端同步修改**：

| 端 | 位置 |
| --- | --- |
| class（课堂端） | `class/script.js` → `APP_CONFIG.version` |
| local（本地版） | `local/script.js` → `APP_CONFIG.version` |
| teacher（教师端） | `teacher/script.js` → `APP_CONFIG.version` |

另有两处**展示用**版本号需一并更新：

- 顶栏标题：各 `index.html` 中的 `作业管理器<span …>vX.Y.Z 课堂端/本地/教师端</span>`
- 关于弹窗更新日志：各 `index.html` 中的 `<span class="changelog-version-tag">vX.Y.Z</span>` 与日期

改完运行 `node build.js` 重新生成 `dist/` 与根 `index.html`。
