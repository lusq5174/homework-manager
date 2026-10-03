#!/usr/bin/env node
/**
 * 把 class / local / teacher 三个目录下的 index.html + style.css + script.js
 * 合并为三个单文件 HTML，输出到 dist/
 *
 * 用法： node build.js
 */
const fs = require('fs');
const path = require('path');

const APPS = [
	{ dir: 'class', out: 'class.html' },
	{ dir: 'local', out: 'local.html' },
	{ dir: 'teacher', out: 'teacher.html' }
];

const root = __dirname;
const dist = path.join(root, 'dist');

/** 防止 CSS 内的 </style> 提前闭合样式块 */
function escapeForStyle(css) {
	return css.replace(/<\/style/gi, '<\\/style');
}

/** 防止 JS 内的 </script>、<!-- 提前闭合或进入注释状态 */
function escapeForScript(js) {
	return js
		.replace(/<\/script/gi, '<\\/script')
		.replace(/<!--/g, '<\\!--');
}

function merge(html, css, js) {
	let out = html;

	// 注意：替换串里含 $ 时必须用函数形式，否则 $$ / $& 会被当成特殊替换模式
	// 1. style.css -> <style>
	const linkRe = /[ \t]*<link[^>]*href\s*=\s*["']style\.css["'][^>]*>[ \t]*\r?\n?/i;
	const styleBlock = '<style>\n' + escapeForStyle(css.trim()) + '\n</style>';
	if (linkRe.test(out)) {
		out = out.replace(linkRe, () => styleBlock);
	} else {
		out = out.replace(/<\/head>/i, () => styleBlock + '\n</head>');
	}

	// 2. script.js -> <script>
	const scriptRe = /[ \t]*<script[^>]*src\s*=\s*["']script\.js["'][^>]*>\s*<\/script>[ \t]*\r?\n?/i;
	const scriptBlock = '<script>\n' + escapeForScript(js.trim()) + '\n</script>';
	if (scriptRe.test(out)) {
		out = out.replace(scriptRe, () => scriptBlock);
	} else if (/<\/body>/i.test(out)) {
		out = out.replace(/<\/body>/i, () => scriptBlock + '\n</body>');
	} else {
		out = out + '\n' + scriptBlock;
	}

	return out;
}

function main() {
	fs.mkdirSync(dist, { recursive: true });

	for (const app of APPS) {
		const dir = path.join(root, app.dir);
		const htmlPath = path.join(dir, 'index.html');
		const cssPath = path.join(dir, 'style.css');
		const jsPath = path.join(dir, 'script.js');

		for (const p of [htmlPath, cssPath, jsPath]) {
			if (!fs.existsSync(p)) {
				console.error(`✖ 缺少文件：${path.relative(root, p)}`);
				process.exit(1);
			}
		}

		const merged = merge(
			fs.readFileSync(htmlPath, 'utf8'),
			fs.readFileSync(cssPath, 'utf8'),
			fs.readFileSync(jsPath, 'utf8')
		);

		const target = path.join(dist, app.out);
		fs.writeFileSync(target, merged, 'utf8');

		const kb = (Buffer.byteLength(merged, 'utf8') / 1024).toFixed(1);
		console.log(`✔ ${app.dir}/ → dist/${app.out}  (${kb} KB)`);
	}

	console.log(`\n完成，共 ${APPS.length} 个文件，输出目录：${path.relative(process.cwd(), dist) || 'dist'}/`);
}

main();
