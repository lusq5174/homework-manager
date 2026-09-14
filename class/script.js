		const $ = (selector) => document.querySelector(selector);
		const $$ = (selector) => document.querySelectorAll(selector);

		const elements = {
			mainContent: $('#main-content'),
			previewMode: $('#preview-mode'),
			editMode: $('#edit-mode'),
			previewSubjects: $('#preview-subjects'),
			currentSubjectTitle: $('#current-subject-title'),
			homeworkList: $('#homework-list'),
			settingsModal: $('#settings-modal'),
			exportArea: $('#export-area'),
			importantDateDisplay: $('#important-date-display'),
			shortcutOptionsList: null,
			timeOptionsList: null,
			importantDatesList: null,
			init() {
				this.shortcutOptionsList = document.getElementById('shortcut-options-list');
				this.timeOptionsList = document.getElementById('time-options-list');
				this.importantDatesList = document.getElementById('important-dates-list');
			}
		};

		elements.init();

		const APP_CONFIG = {
			"appName": "作业管理器（课堂端）",
			"version": "v3.1.0",
			"maxBoundClasses": 1,
			"bindTip": "课堂端仅允许绑定 1 个云班级，如需绑定新班级，请先移除绑定的班级。",
			"bindLimitAlert": "课堂端仅允许绑定 1 个云班级。如需绑定新班级，请先移除绑定的班级。"
		};

		function isBindingLimitReached(nextBindCode) {
			const max = APP_CONFIG.maxBoundClasses;
			if (max == null) return false;
			if (boundClass && boundClass.bindCode === nextBindCode) return false;
			return boundClass !== null;
		}

		function showLoadingOverlay(text = '加载中...') {
			const overlay = document.getElementById('loading-overlay');
			const textEl = document.getElementById('loading-text');
			if (textEl) textEl.textContent = text;
			if (overlay) overlay.classList.add('active');
		}

		function hideLoadingOverlay() {
			const overlay = document.getElementById('loading-overlay');
			if (overlay) overlay.classList.remove('active');
		}

		function applyVariantUI() {
			document.title = APP_CONFIG.appName;
			const tip = document.getElementById('bind-limit-tip');
			if (tip) tip.textContent = APP_CONFIG.bindTip || '';
		}

		const subjects = [
			"全部", "语文", "数学", "英语", "物理", "化学", "政治", "历史", "生物", "地理", "其他"
		];

		const DEFAULT_GLOBAL_SETTINGS = {
			shortcuts: ["补充", "学评", "小题", "综素", "同步", "订正", "背诵", "练测", "学习笔记"],
			timeOptions: ["晚前", "限时", "晚一", "晚二", "晚三", "明早", "明晚", "不收", "选做"],
			importantDates: []
		};

		const DEFAULT_CLASS_SETTINGS = {
			className: "未绑定",
			bindCode: "无",
			exportTitle: "班级作业",
			exportAddDate: true,
			exportFontSize: 30,
			autoDeleteDaily: true
		};

		let classSettings = {...DEFAULT_CLASS_SETTINGS};
		let globalSettings = {...DEFAULT_GLOBAL_SETTINGS};

		let currentSubject = "全部";
		let activeInput = null;
		let homeworkData = {};

		let supabaseClient = null;
		let boundClass = null;
		let currentClassBindCode = null;
		let sbRealtimeChannel = null;

		/* ==================== 云端作业变更冲突检测 ==================== */
		let cloudHomeworkSignature = null;   // 最近一次已知的云端作业数据指纹
		let cloudConflictPending = false;    // 编辑作业期间收到云端变更且尚未处理

		// 生成与科目/字段顺序无关的作业数据指纹，用于判断云端作业是否被改动
		function homeworkSignature(rawHw) {
			const src = rawHw || {};
			const out = {};
			subjects.forEach(subject => {
				if (subject === "全部") return;
				const item = src[subject] || {};
				const list = Array.isArray(item.homeworks) ? item.homeworks : [];
				out[subject] = list.map(hw => [
					String((hw && hw.content) || ""),
					String((hw && hw.estimatedTime) || ""),
					String((hw && hw.submitTime) || ""),
					(hw && hw.locked) ? 1 : 0
				]);
			});
			return JSON.stringify(out);
		}

		// 是否正处于作业编辑状态（“全部”为预览模式，不算编辑）
		function isHomeworkEditing() {
			return !!currentSubject && currentSubject !== "全部"
				&& elements.editMode && elements.editMode.style.display !== 'none';
		}

		function showCloudConflictWarning() {
			cloudConflictPending = true;
			const modal = document.getElementById('cloud-conflict-modal');
			if (modal) modal.classList.add('active');
		}

		function closeCloudConflictWarning() {
			const modal = document.getElementById('cloud-conflict-modal');
			if (modal) modal.classList.remove('active');
		}

		function refreshAfterCloudConflict() {
			window.location.reload();
		}

		/* ==================== 上传前的最后一次云端校验 ====================
		   实时推送与轮询都可能漏掉变更，所以在真正写云端之前再取一次数据比对：
		   若云端作业已被改动，就中止本次上传，交给用户决定是否覆盖。 */
		let pendingSaveRetry = null;   // 「仍然覆盖保存」要重跑的动作

		async function verifyCloudBeforeUpload() {
			// 未配置云端时保持原有行为（uploadHomeworkToSb 自己会直接返回），不要拦在这里
			if (!ensureSupabase()) return { ok: true, row: undefined };
			const row = await fetchSbRow(currentClassBindCode);
			if (lastSbError) return { ok: false, readFailed: true, row: undefined };
			const incomingSig = homeworkSignature((row && row.homework_data) || {});
			if (cloudHomeworkSignature != null && incomingSig !== cloudHomeworkSignature) {
				return { ok: false, readFailed: false, row };
			}
			return { ok: true, row };
		}

		function showSaveConflictWarning(retryAction) {
			pendingSaveRetry = typeof retryAction === "function" ? retryAction : null;
			const modal = document.getElementById('save-conflict-modal');
			if (modal) modal.classList.add('active');
		}

		function closeSaveConflictWarning() {
			pendingSaveRetry = null;
			const modal = document.getElementById('save-conflict-modal');
			if (modal) modal.classList.remove('active');
		}

		// 「仍然覆盖保存」：用户已明确确认，重跑刚才被中止的上传
		function confirmSaveOverwrite() {
			const act = pendingSaveRetry;
			pendingSaveRetry = null;
			const modal = document.getElementById('save-conflict-modal');
			if (modal) modal.classList.remove('active');
			closeCloudConflictWarning();
			cloudConflictPending = false;
			if (typeof act === "function") act();
		}

		function refreshAfterSaveConflict() {
			window.location.reload();
		}

		const LS_KEYS = {
			global: "homeworkManagerGlobalSettings",
			boundClass: "homeworkManagerBoundClass",
			sbUrl: "homeworkManagerSupabaseUrl",
			sbKey: "homeworkManagerSupabaseKey"
		};

		/* 「每日自动删除作业」由云端数据库的定时任务执行（读取 settings.autoDeleteDaily）。
		   前端只负责把这个开关标记进云端数据，不再在本地执行删除，避免与云端任务冲突。 */
		function withAutoDeleteMark(settings) {
			return {
				...(settings || {}),
				autoDeleteDaily: !!classSettings.autoDeleteDaily
			};
		}

		function getLocal(key, fallback) {
			try {
				const v = localStorage.getItem(key);
				return v == null ? fallback : JSON.parse(v);
			} catch (e) { return fallback; }
		}
		function setLocal(key, value) {
			localStorage.setItem(key, JSON.stringify(value));
		}

		function getSbCreds() {
			return {
				url: localStorage.getItem(LS_KEYS.sbUrl) || "",
				key: localStorage.getItem(LS_KEYS.sbKey) || ""
			};
		}

		function ensureSupabase() {
			const { url, key } = getSbCreds();
			if (!url || !key) { supabaseClient = null; return null; }
			if (typeof supabase === "undefined" || typeof supabase.createClient !== "function") { supabaseClient = null; return null; }
			if (!supabaseClient || supabaseClient._url !== url || supabaseClient._key !== key) {
				supabaseClient = supabase.createClient(url, key);
			}
			return supabaseClient;
		}

		function hasSbCreds() {
			const { url, key } = getSbCreds();
			return !!url && !!key;
		}

		async function classExists(bindCode) {
			const client = ensureSupabase();
			if (!client) return false;
			const { data, error } = await client.from("class_data").select("id").eq("bind_code", bindCode).limit(1);
			if (error) return false;
			return !!(data && data.length > 0);
		}

		// 最近一次 Supabase 读写失败的原因（成功则清空）：用于区分「读不到」与「该班级云端还没有行」
		let lastSbError = null;

		async function fetchSbRow(bindCode) {
			const client = ensureSupabase();
			if (!client) { lastSbError = "未配置 Supabase 连接（请检查项目地址与接口密钥）"; return null; }
			const { data, error } = await client.from("class_data").select("*").eq("bind_code", bindCode).limit(1);
			if (error) { lastSbError = error.message || String(error); return null; }
			lastSbError = null;
			return data && data.length ? data[0] : null;
		}

		async function upsertSbRow(row) {
			const client = ensureSupabase();
			if (!client) { lastSbError = "未配置 Supabase 连接（请检查项目地址与接口密钥）"; return null; }
			const { data, error } = await client.from("class_data").upsert(row, { onConflict: "bind_code" }).select();
			if (error) { lastSbError = error.message || String(error); console.error("upsertSbRow error", error); return null; }
			lastSbError = null;
			return data && data.length ? data[0] : null;
		}

		async function fetchClassSettings(bindCode) {
			if (!bindCode) return {...DEFAULT_CLASS_SETTINGS};
			const row = await fetchSbRow(bindCode);
			if (!row) return null;
			const s = row.settings || {};
			return {
				className: row.class_name || (s.className || "班级"),
				bindCode: row.bind_code,
				exportTitle: s.exportTitle ?? DEFAULT_CLASS_SETTINGS.exportTitle,
				exportAddDate: s.exportAddDate ?? DEFAULT_CLASS_SETTINGS.exportAddDate,
				exportFontSize: s.exportFontSize ?? DEFAULT_CLASS_SETTINGS.exportFontSize,
				autoDeleteDaily: s.autoDeleteDaily ?? DEFAULT_CLASS_SETTINGS.autoDeleteDaily
			};
		}

		async function saveClassSettingsToStore(s) {
			if (!currentClassBindCode) return false;
			const row = await fetchSbRow(currentClassBindCode);
			const newRow = {
				bind_code: currentClassBindCode,
				class_name: s.className || "班级",
				settings: {
					...((row && row.settings) || {}),
					exportTitle: s.exportTitle,
					exportAddDate: !!s.exportAddDate,
					exportFontSize: Number(s.exportFontSize) || DEFAULT_CLASS_SETTINGS.exportFontSize,
					autoDeleteDaily: !!s.autoDeleteDaily
				},
				homework_data: (row && row.homework_data) || {},
				announcement: (row && row.announcement) || [],
				updated_at: new Date().toISOString()
			};
			const res = await upsertSbRow(newRow);
			return !!res;
		}

		function loadGlobalSettings() {
			const g = getLocal(LS_KEYS.global, null);
			if (g) globalSettings = {...DEFAULT_GLOBAL_SETTINGS, ...g};
		}
		function saveGlobalSettings() {
			setLocal(LS_KEYS.global, globalSettings);
		}

		function loadBoundClass() {
			boundClass = getLocal(LS_KEYS.boundClass, null);
		}
		function saveBoundClass() {
			setLocal(LS_KEYS.boundClass, boundClass);
		}

		function refreshClassUI() {
			refreshSubjectItemsState();
		}

		// 同步科目按钮和公告编辑按钮禁用状态（无绑定班级时禁用）
		function refreshSubjectItemsState() {
			const disabled = !currentClassBindCode;
			$$('.subject-item').forEach(item => {
				if (item.dataset.subject === '全部') return;
				item.classList.toggle('disabled', disabled);
			});
			const editBtn = document.querySelector('.btn-warning[onclick="editAnnouncement()"]');
			if (editBtn) editBtn.classList.toggle('disabled', disabled);
		}

		async function bindNewClass(bindCode) {
			bindCode = (bindCode || "").trim().toUpperCase();
			if (!bindCode) { alert("请输入绑定码"); return false; }
			if (!ensureSupabase()) { alert("请检查项目地址和接口密钥"); return false; }
			if (isBindingLimitReached(bindCode)) { alert(APP_CONFIG.bindLimitAlert); return false; }
			const exists = await classExists(bindCode);
			if (!exists) { alert("绑定码无效"); return false; }
			if (!boundClass || boundClass.bindCode !== bindCode) {
				const row = await fetchSbRow(bindCode);
				boundClass = {
					bindCode,
					className: (row && row.class_name) || ("班级-" + bindCode)
				};
				saveBoundClass();
			}
			currentClassBindCode = bindCode;
			refreshClassUI();
			await applyCurrentClass(true);
			return true;
		}

		async function removeBoundClass(bindCode) {
			if (boundClass && boundClass.bindCode === bindCode) {
				boundClass = null;
				saveBoundClass();
			}
			if (currentClassBindCode === bindCode) {
				currentClassBindCode = null;
			}
			refreshClassUI();
			renderBoundClassesUI();
			updateClassSettingsUI();
			await applyCurrentClass(true);
		}

		async function applyCurrentClass(reloadHomework) {
			const s = await fetchClassSettings(currentClassBindCode);
			if (s) classSettings = {...DEFAULT_CLASS_SETTINGS, ...s};
			if (reloadHomework) await reloadHomeworkForCurrentClass();
			// 每日自动删除作业已由云端数据库定时任务负责，本地不再执行
			updatePreview();
			updateClassSettingsUI();
			const contentDiv = document.getElementById('announcement-content');
			if (contentDiv) {
				const items = await loadAnnouncement();
				renderAnnouncementContent(items);
			}
		}

		async function reloadHomeworkForCurrentClass() {
			unsubscribeRealtime();
			initHomeworkData();
			cloudConflictPending = false;
			closeCloudConflictWarning();
			stopEditModeCloudWatch();
			if (!currentClassBindCode) {
				cloudHomeworkSignature = null;
				ensureHomeworkLockedProperty();
				return;
			}
			const row = await fetchSbRow(currentClassBindCode);
			const hw = (row && row.homework_data) || {};
			subjects.forEach(subject => {
				if (subject !== "全部") {
					homeworkData[subject] = hw[subject] || { homeworks: [] };
					if (!homeworkData[subject].homeworks) homeworkData[subject].homeworks = [];
				}
			});
			ensureHomeworkLockedProperty();
			// 记录本次读取到的云端作业基线
			cloudHomeworkSignature = homeworkSignature(hw);
			setupRealtime();
		}

		/* prefetchedRow：上传前校验时刚取回的行，直接复用可省一次读取，也保证「最后一次读到的
		   云端数据」就是写入时所依据的版本；传 undefined 表示未校验过，函数内部自行读取。 */
		async function uploadHomeworkToSb(prefetchedRow) {
			// 调用方可能已拉起「正在校验云端数据...」遮罩，提前退出时要顺手关掉，否则会一直盖在页面上
			if (!currentClassBindCode) { hideLoadingOverlay(); return; }
			const client = ensureSupabase();
			if (!client) { hideLoadingOverlay(); return; }
			showLoadingOverlay('正在上传...');
			try {
				const row = prefetchedRow === undefined ? await fetchSbRow(currentClassBindCode) : prefetchedRow;
				const newRow = {
					bind_code: currentClassBindCode,
					class_name: classSettings.className || (row && row.class_name) || "班级",
					settings: withAutoDeleteMark(row && row.settings),
					homework_data: homeworkData,
					announcement: (row && row.announcement) || [],
					updated_at: new Date().toISOString()
				};
				// 先更新本地基线，避免自己写入后回传的事件被当作“云端变更”而误报
				cloudHomeworkSignature = homeworkSignature(homeworkData);
				cloudConflictPending = false;
				closeCloudConflictWarning();
				await upsertSbRow(newRow);
			} finally {
				hideLoadingOverlay();
			}
		}

		function setupRealtime() {
			unsubscribeRealtime();
			if (!currentClassBindCode) return;
			const client = ensureSupabase();
			if (!client) return;
			try {
				sbRealtimeChannel = client.channel("class_data_changes")
					.on("postgres_changes",
						{ event: "UPDATE", schema: "public", table: "class_data", filter: `bind_code=eq.${currentClassBindCode}` },
						(payload) => {
							try {
								const row = payload.new || {};
								if (row.class_name) classSettings.className = row.class_name;
								const s = row.settings || {};
								if (s.exportTitle != null) classSettings.exportTitle = s.exportTitle;
								if (s.exportAddDate != null) classSettings.exportAddDate = !!s.exportAddDate;
								if (s.exportFontSize != null) classSettings.exportFontSize = Number(s.exportFontSize) || DEFAULT_CLASS_SETTINGS.exportFontSize;
								if (s.autoDeleteDaily != null) classSettings.autoDeleteDaily = !!s.autoDeleteDaily;

								const hwProvided = Object.prototype.hasOwnProperty.call(row, "homework_data");
								const hw = row.homework_data || {};
								const incomingSig = hwProvided ? homeworkSignature(hw) : null;
								const hwChanged = hwProvided && incomingSig !== cloudHomeworkSignature;

								/* 正在编辑作业时收到云端作业变更：不覆盖本地编辑内容，仅弹出警告 */
								if (hwChanged && isHomeworkEditing()) {
									cloudHomeworkSignature = incomingSig;
									showCloudConflictWarning();
									return;
								}

								if (hwProvided) {
									cloudHomeworkSignature = incomingSig;
									subjects.forEach(subject => {
										if (subject !== "全部") {
											homeworkData[subject] = hw[subject] || { homeworks: [] };
											if (!homeworkData[subject].homeworks) homeworkData[subject].homeworks = [];
										}
									});
									ensureHomeworkLockedProperty();
								}
							updateClassSettingsUI();
							if (currentSubject === "全部") {
							updatePreview();
							const items = parseAnnouncement(row.announcement);
							const contentDiv = document.getElementById('announcement-content');
							const editorDiv = document.getElementById('announcement-editor');
							if (contentDiv && (!editorDiv || editorDiv.style.display !== 'block')) {
								renderAnnouncementContent(items);
							}
						} else if (hwChanged) {
							updateHomeworkList();
						}
						refreshEveningStudy();
							} catch (e) { console.error("realtime apply error", e); }
						})
					.subscribe();
			} catch (e) { console.warn("realtime init failed", e); }
		}

		function unsubscribeRealtime() {
			if (sbRealtimeChannel) {
				try { sbRealtimeChannel.unsubscribe(); } catch (e) {}
				sbRealtimeChannel = null;
			}
		}

		/* 编辑作业期间必须保持实时订阅，否则收不到云端变更、冲突提示永远不会出现。
		   仅在尚未订阅时建立连接，已订阅则直接复用，避免重新加入频道造成监听空窗。 */
		function ensureRealtime() {
			if (!currentClassBindCode) return;
			if (sbRealtimeChannel) return;
			setupRealtime();
		}

		/* 编辑期间的兜底检测：Realtime 偶发断连或事件丢失时靠轮询发现云端作业变更。
		   只做“发现并告警”，绝不覆盖本地正在编辑的内容。 */
		let editWatchTimer = null;

		function stopEditModeCloudWatch() {
			if (editWatchTimer) { clearInterval(editWatchTimer); editWatchTimer = null; }
		}

		// 单次兜底检查：云端作业与本地基线不一致即告警
		async function runEditCloudCheck() {
			if (!currentClassBindCode || !isHomeworkEditing()) return;
			try {
				const row = await fetchSbRow(currentClassBindCode);
				if (!row || !row.homework_data) return;
				const sig = homeworkSignature(row.homework_data);
				if (sig === cloudHomeworkSignature) return;
				cloudHomeworkSignature = sig;
				showCloudConflictWarning();
			} catch (e) { console.error("edit cloud watch error", e); }
		}

		function startEditModeCloudWatch() {
			stopEditModeCloudWatch();
			if (!currentClassBindCode) return;
			editWatchTimer = setInterval(runEditCloudCheck, 20000);
		}

		function fallbackCopy(text, onSuccess) {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			try { document.execCommand("copy"); if (onSuccess) onSuccess(); } catch (e) {}
			document.body.removeChild(ta);
		}
		function copyText(text, btnEl, successText = '复制成功') {
			const origText = btnEl ? btnEl.innerHTML : "";
			const flash = () => {
				if (btnEl) btnEl.innerHTML = successText;
				setTimeout(() => { if (btnEl) btnEl.innerHTML = origText; }, 1000);
			};
			if (navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(text).then(flash).catch(() => fallbackCopy(text, flash));
			} else {
				fallbackCopy(text, flash);
			}
		}
		function copyCurrentBindCode(btnEl) {
			const code = classSettings.bindCode || "无";
			if (code === "无") return;
			copyText(code, btnEl, '复制成功');
		}

		function renderBoundClassesUI() {
			const grid = document.getElementById("bound-class-grid");
			if (!grid) return;
			grid.innerHTML = "";
			if (boundClass) {
				const card = document.createElement("div");
				card.className = "bound-class-card";

				const name = document.createElement("div");
				name.className = "bc-name";
				name.textContent = boundClass.className || "班级";

				const codeRow = document.createElement("div");
				codeRow.className = "bc-code-row";

				const code = document.createElement("span");
				code.className = "bc-code";
				code.textContent = boundClass.bindCode;

				const copy = document.createElement("button");
				copy.className = "bc-copy";
				copy.title = "复制绑定码";
				copy.innerHTML = '<i class="fa-solid fa-clipboard-list"></i>';
				copy.addEventListener("click", () => copyText(boundClass.bindCode, copy, '<i class="fa-solid fa-circle-check"></i>'));

				const del = document.createElement("button");
				del.className = "bc-delete";
				del.textContent = "移除绑定";
				del.addEventListener("click", () => removeBoundClass(boundClass.bindCode));

				codeRow.append(code, copy);
				card.append(name, codeRow, del);
				grid.appendChild(card);
			}
		}

		function escapeHtml(s) {
			const map = {
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&#39;',
				'`': '&#96;'
			};
			return String(s == null ? "" : s).replace(/[&<>"'`]/g, c => map[c]);
		}

		window.copyTextInline = function(btnEl, text) {
			copyText(text, btnEl, '<i class="fa-solid fa-circle-check"></i>');
		};

		function updateClassSettingsUI() {
			const nm = document.getElementById("cls-class-name");
			const bc = document.getElementById("cls-bind-code-box");
			const et = document.getElementById("cls-export-title");
			const ef = document.getElementById("cls-export-font-size");
			const ea = document.getElementById("cls-export-add-date");
			const ad = document.getElementById("cls-auto-delete-daily");

			if (nm) nm.value = classSettings.className || "未绑定";
			if (et) et.value = classSettings.exportTitle || "";
			if (ef) ef.value = classSettings.exportFontSize ?? "";
			if (ea) ea.checked = !!classSettings.exportAddDate;
			if (ad) ad.checked = !!classSettings.autoDeleteDaily;

			if (bc) {
				bc.textContent = classSettings.bindCode || currentClassBindCode || "无";
			}

			const urlEl = document.getElementById("sb-project-url");
			const keyEl = document.getElementById("sb-api-key");
			const { url, key } = getSbCreds();
			if (urlEl) urlEl.value = url || "";
			if (keyEl) keyEl.value = key || "";
			const bound = boundClass !== null;
			if (urlEl) urlEl.disabled = bound;
			if (keyEl) keyEl.disabled = bound;
			renderBoundClassesUI();
		}

		function openSettings() {
			ensureSupabase();
			loadGlobalSettings();
			loadBoundClass();
			refreshClassUI();
			(async () => {
				await applyCurrentClass(false);
			})();

			const urlEl = document.getElementById("sb-project-url");
			const keyEl = document.getElementById("sb-api-key");
			if (urlEl && !urlEl.dataset.bound) {
				urlEl.dataset.bound = "1";
				urlEl.addEventListener("input", function() {
					localStorage.setItem(LS_KEYS.sbUrl, this.value.trim());
					ensureSupabase();
				});
			}
			if (keyEl && !keyEl.dataset.bound) {
				keyEl.dataset.bound = "1";
				keyEl.addEventListener("input", function() {
					localStorage.setItem(LS_KEYS.sbKey, this.value.trim());
					ensureSupabase();
				});
			}

			updateClassSettingsUI();
			generateShortcutOptionsList();
			generateTimeOptionsList();
			generateImportantDatesList();
			elements.settingsModal.classList.add('active');
		}

		function closeSettings() {
			elements.settingsModal.classList.remove('active');
		}

		function openAbout() {
			document.getElementById('about-modal').classList.add('active');
		}

		function closeAbout() {
			document.getElementById('about-modal').classList.remove('active');
		}

		/* ==================== 检查更新 ==================== */
		function parseVersion(versionStr) {
			const match = String(versionStr || '').match(/(\d+(\.\d+)*)/);
			if (!match) return [0];
			return match[1].split('.').map(Number);
		}
		function compareVersions(a, b) {
			const va = parseVersion(a), vb = parseVersion(b);
			const maxLen = Math.max(va.length, vb.length);
			for (let i = 0; i < maxLen; i++) {
				const na = va[i] || 0, nb = vb[i] || 0;
				if (na > nb) return 1;
				if (na < nb) return -1;
			}
			return 0;
		}
		async function checkForUpdates() {
			try {
				const today = new Date().toISOString().split('T')[0];
				const lastCheck = localStorage.getItem('lastUpdateCheck');
				if (lastCheck === today) return;
				localStorage.setItem('lastUpdateCheck', today);
				const resp = await fetch('https://api.github.com/repos/lusq5174/homework-manager/releases/latest', {
					headers: { 'Accept': 'application/vnd.github+json' }
				});
				if (!resp.ok) return;
				const data = await resp.json();
				if (!data || !data.tag_name) return;
				if (compareVersions(data.tag_name, APP_CONFIG.version) !== 0) {
					showUpdateModal(data.tag_name, data.html_url || 'https://github.vom/lusq5174/homework-manager', data.body || '');
				}
			} catch (e) { /* 网络错误静默处理 */ }
		}
		function showUpdateModal(remoteVersion, releaseUrl, releaseNotes) {
			const modal = document.getElementById('update-modal');
			if (!modal) return;
			document.getElementById('update-remote-version').textContent = remoteVersion;
			document.getElementById('update-current-version').textContent = APP_CONFIG.version;
			const link = document.getElementById('update-release-link');
			if (link) link.href = releaseUrl;
			const notesEl = document.getElementById('update-release-notes');
			if (notesEl) notesEl.textContent = releaseNotes ? releaseNotes.slice(0, 500) + (releaseNotes.length > 500 ? '...' : '') : '';
			modal.classList.add('active');
		}
		function closeUpdateModal() {
			const modal = document.getElementById('update-modal');
			if (modal) modal.classList.remove('active');
		}

		async function saveClassSettings() {
			const nmEl = document.getElementById("cls-class-name");
			const etEl = document.getElementById("cls-export-title");
			const efEl = document.getElementById("cls-export-font-size");
			const eaEl = document.getElementById("cls-export-add-date");
			const adEl = document.getElementById("cls-auto-delete-daily");

			const payload = {
				className: (nmEl && nmEl.value.trim()) || boundClass?.className || "未绑定",
				bindCode: currentClassBindCode || "无",
				exportTitle: (etEl && etEl.value.trim()) || "作业",
				exportFontSize: parseInt(efEl && efEl.value) || DEFAULT_CLASS_SETTINGS.exportFontSize,
				exportAddDate: !!(eaEl && eaEl.checked),
				autoDeleteDaily: !!(adEl && adEl.checked)
			};

			if (!currentClassBindCode) {
				classSettings = {...payload};
				alert("请先绑定班级后再保存设置");
				return;
			}

			const ok = await saveClassSettingsToStore(payload);
			if (!ok) { alert("保存失败，请检查 Supabase 配置或网络"); return; }
			classSettings = {...payload};
			if (boundClass && boundClass.bindCode === currentClassBindCode) {
				boundClass.className = payload.className;
			}
			saveBoundClass();
			refreshClassUI();
			alert("已保存班级设置");
			updatePreview();
		}

		async function addClassByBindCode() {
			const input = document.getElementById("sb-bind-code");
			const code = (input && input.value) || "";
			if (!hasSbCreds()) { alert("请先填写项目地址和接口密钥"); return; }
			const ok = await bindNewClass(code);
			if (ok && input) input.value = "";
			renderBoundClassesUI();
		}

		function generateShortcutOptionsList() {
			generateOptionsList(elements.shortcutOptionsList, globalSettings.shortcuts, 'updateShortcutOption', 'deleteShortcutOption');
		}

		function generateTimeOptionsList() {
			generateOptionsList(elements.timeOptionsList, globalSettings.timeOptions, 'updateTimeOption', 'deleteTimeOption');
		}

		function generateOptionsList(container, items, updateFunc, deleteFunc, itemTemplate) {
			container.innerHTML = '';
			items.forEach((item, index) => {
				const optionItem = document.createElement('div');
				optionItem.className = 'option-item';
				if (itemTemplate) {
					optionItem.innerHTML = itemTemplate(item, index);
				} else {
					optionItem.innerHTML = `
						<input type="text" class="option-input" value="${escapeHtml(item)}" oninput="${updateFunc}(${index}, this.value)">
						<button class="btn btn-danger delete-option-btn" onclick="${deleteFunc}(${index})">删除</button>
					`;
				}
				container.appendChild(optionItem);
			});
		}

		function addOption(list, generateFunc, container) {
			list.push(typeof list[0] === 'object' ? { name: '', date: '' } : '');
			saveGlobalSettings();
			generateFunc();
			const items = container.querySelectorAll('.option-item');
			const last = items[items.length - 1];
			if (last) { last.classList.add('fade-in'); setTimeout(() => last.classList.remove('fade-in'), 10); }
		}

		function deleteOption(list, generateFunc, container, index) {
			const items = container.querySelectorAll('.option-item');
			const target = items[index];
			if (target) {
				target.classList.add('fade-out');
				setTimeout(() => {
					list.splice(index, 1);
					saveGlobalSettings();
					generateFunc();
				}, 300);
			}
		}

		function generateImportantDatesList() {
			const dateTemplate = (date, index) => `
				<input type="text" class="option-input" value="${escapeHtml(date.name)}" placeholder="日期名称" oninput="updateImportantDateName(${index}, this.value)">
				<input type="date" class="option-input" value="${escapeHtml(date.date)}" oninput="updateImportantDateDate(${index}, this.value)">
				<button class="btn btn-danger delete-option-btn" onclick="deleteImportantDate(${index})">删除</button>
			`;
			generateOptionsList(elements.importantDatesList, globalSettings.importantDates, null, null, dateTemplate);
		}

		function updateShortcutOption(index, value) {
			globalSettings.shortcuts[index] = value; saveGlobalSettings();
		}
		function addShortcutOption() {
			addOption(globalSettings.shortcuts, generateShortcutOptionsList, elements.shortcutOptionsList);
		}
		function deleteShortcutOption(index) {
			deleteOption(globalSettings.shortcuts, generateShortcutOptionsList, elements.shortcutOptionsList, index);
		}

		function updateTimeOption(index, value) {
			globalSettings.timeOptions[index] = value; saveGlobalSettings();
		}
		function addTimeOption() {
			addOption(globalSettings.timeOptions, generateTimeOptionsList, elements.timeOptionsList);
		}
		function deleteTimeOption(index) {
			deleteOption(globalSettings.timeOptions, generateTimeOptionsList, elements.timeOptionsList, index);
		}

		function updateImportantDateName(index, value) {
			globalSettings.importantDates[index].name = value; saveGlobalSettings();
			updateImportantDateDisplay(); checkAndStartScroll();
		}
		function updateImportantDateDate(index, value) {
			globalSettings.importantDates[index].date = value; saveGlobalSettings();
			updateImportantDateDisplay(); checkAndStartScroll();
		}
		function addImportantDateOption() {
			globalSettings.importantDates.push({ name: '', date: '' }); saveGlobalSettings();
			generateImportantDatesList();
			const items = elements.importantDatesList.querySelectorAll(".option-item");
			const last = items[items.length - 1];
			if (last) { last.classList.add("fade-in"); setTimeout(() => last.classList.remove("fade-in"), 10); }
			updateImportantDateDisplay(); checkAndStartScroll();
		}
		function deleteImportantDate(index) {
			const items = elements.importantDatesList.querySelectorAll(".option-item");
			const target = items[index];
			if (target) {
				target.classList.add("fade-out");
				setTimeout(() => {
					globalSettings.importantDates.splice(index, 1); saveGlobalSettings();
					generateImportantDatesList();
					updateImportantDateDisplay(); checkAndStartScroll();
				}, 300);
			}
		}

		let currentImportantDateIndex = 0;
		let scrollTimer = null;

		function calculateDaysUntilImportantDate(targetDate) {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const target = new Date(targetDate);
			target.setHours(0, 0, 0, 0);
			const timeDiff = target - today;
			return Math.floor(timeDiff / (1000 * 60 * 60 * 24));
		}

		function generateImportantDateText(date) {
			if (!date.name || !date.date) return '';
			const daysDiff = calculateDaysUntilImportantDate(date.date);
			let text = '';
			if (daysDiff > 0) {
				text = `距离 ${date.name} 还有 ${daysDiff} 天`;
			} else if (daysDiff === 0) {
				text = `${date.name} 是今天`;
			} else {
				text = `${date.name} 已过去 ${Math.abs(daysDiff)} 天`;
			}
			return text;
		}

		function checkAndStartScroll() {
			if (scrollTimer) { clearInterval(scrollTimer); scrollTimer = null; }
			const valid = globalSettings.importantDates.filter(d => d.name && d.date);
			if (valid.length > 1) {
				scrollTimer = setInterval(updateImportantDateDisplay, 10000);
			}
		}

		function updateImportantDateDisplay() {
			const valid = globalSettings.importantDates.filter(d => d.name && d.date);
			const display = document.getElementById("important-date-display") || elements.importantDateDisplay;
			if (valid.length === 0) { display.textContent = ''; return; }
			currentImportantDateIndex = currentImportantDateIndex % valid.length;
			if (currentImportantDateIndex < 0) currentImportantDateIndex = valid.length - 1;
			display.style.opacity = '0';
			setTimeout(() => {
				display.textContent = generateImportantDateText(valid[currentImportantDateIndex]);
				display.style.opacity = '1';
				currentImportantDateIndex++;
			}, 250);
		}

		function startImportantDateScroll() {
			const display = document.getElementById("important-date-display") || elements.importantDateDisplay;
			display.style.opacity = '1';
			updateImportantDateDisplay();
			checkAndStartScroll();
		}

		async function switchSubject(subject, options) {
			const opts = options || {};
			// 无绑定班级时，仅允许"全部"展示提示，其他科目按钮无效
			if (!currentClassBindCode && subject !== '全部') return;
			// 切回“全部”即提交保存：若编辑期间云端作业已被改动，先提醒保存会覆盖云端内容
			if (subject === "全部" && !opts.skipUpload && cloudConflictPending) {
				const goOn = confirm('当前班级的云端作业已被修改，继续保存将覆盖云端的最新内容。\n建议先刷新页面查看最新内容后重新编辑。\n\n仍要保存并覆盖吗？');
				if (!goOn) return;
				cloudConflictPending = false;
				closeCloudConflictWarning();
				opts.overwriteConfirmed = true;   // 用户已明确选择覆盖，下面不再重复校验
			}
			// 上传前最后从云端取一次数据：编辑期间云端作业若被改动（实时推送可能丢失），这里兜住
			let verifiedRow;   // undefined = 未做校验，交给上传函数自己再取一次
			if (subject === "全部" && !opts.skipUpload && !opts.overwriteConfirmed
				&& currentClassBindCode && currentSubject !== "全部") {
				showLoadingOverlay('正在校验云端数据...');
				const v = await verifyCloudBeforeUpload();
				if (!v.ok) {
					hideLoadingOverlay();
					if (v.readFailed) {
						alert('无法读取云端数据（' + lastSbError + '），为避免覆盖云端内容，本次上传已取消。\n请检查网络后重试。');
						return;
					}
					// 停留编辑态，等用户在弹窗里选择刷新 / 继续编辑 / 仍然覆盖
					showSaveConflictWarning(() => switchSubject("全部", { overwriteConfirmed: true }));
					return;
				}
				verifiedRow = v.row;
			}
			currentSubject = subject;
			$$('.subject-item').forEach(item => item.classList.remove('active'));
			const activeItem = document.querySelector(`.subject-item[data-subject="${subject}"]`);
			if (activeItem) activeItem.classList.add('active');

			if (subject === "全部") {
				stopEditModeCloudWatch();
				// 立刻切换到预览模式
				document.body.classList.add('preview-mode-active');
				elements.previewMode.style.display = "flex";
				elements.editMode.style.display = "none";
				
				const shortcutSidebar = document.querySelector('.shortcut-sidebar');
				if (shortcutSidebar) {
					if (!shortcutSidebar.dataset.originalContent) {
						shortcutSidebar.dataset.originalContent = '<div class="shortcut-title">快捷输入</div>';
					}
					shortcutSidebar.classList.add('announcement-mode');
					if (!document.getElementById('announcement-content')) {
						shortcutSidebar.innerHTML = `
							<div style="display: flex; justify-content: space-between; align-items: center; font-size: 20px; font-weight: 600; color: #333; flex-wrap: wrap; gap: 8px;">
								<span>公告</span>
								<button class="btn btn-warning ${!currentClassBindCode ? 'disabled' : ''}" onclick="editAnnouncement()" style="flex-shrink: 0; white-space: nowrap;">编辑</button>
							</div>
							<div id="announcement-content" style="font-size: 20px; line-height: 1.2; min-height: 200px;word-wrap: break-word; word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;"></div>
							<div id="announcement-editor" style="display: none; margin-top: 12px;"></div>
						`;
					}
				}
				
				if (currentClassBindCode) {
					// 先显示预览内容（保持之前加载的数据）
					updatePreview();
					// 加载公告
					loadAnnouncement().then(items => {
						renderAnnouncementContent(items);
					});
					// 后台异步上传，不阻塞UI
					if (opts.skipUpload) {
						// 应用启动/切换班级加载：只读取云端数据，不回写云端
						unsubscribeRealtime();
						setupRealtime();
					} else {
						uploadHomeworkToSb(verifiedRow).then(() => {
							unsubscribeRealtime();
							setupRealtime();
						});
					}
				} else {
					updatePreview();
					const items = await loadAnnouncement();
					renderAnnouncementContent(items);
				}
			} else {
				// 进入编辑模式不再断开实时订阅：冲突检测依赖它接收云端变更
				ensureRealtime();
				startEditModeCloudWatch();
				document.body.classList.remove('preview-mode-active');
				elements.previewMode.style.display = "none";
				elements.editMode.style.display = "flex";
				elements.currentSubjectTitle.textContent = subject;
				const sci = subjects.indexOf(subject);
				elements.currentSubjectTitle.className = (sci > 0 ? "sc-" + sci : "");
				updateHomeworkList();

				const shortcutSidebar = document.querySelector('.shortcut-sidebar');
				if (shortcutSidebar && shortcutSidebar.dataset.originalContent) {
					shortcutSidebar.classList.remove('announcement-mode');
					shortcutSidebar.innerHTML = shortcutSidebar.dataset.originalContent;
					updateShortcutSidebar();
				}
			}
		}

		function init() {
			showLoadingOverlay('正在加载应用...');
			initTheme();
			loadGlobalSettings();
			loadBoundClass();
			currentClassBindCode = boundClass ? boundClass.bindCode : null;
			ensureSupabase();

			refreshClassUI();
			applyVariantUI();

			initHomeworkData();

			(async () => {
				try {
					await applyCurrentClass(true);
					startImportantDateScroll();
					await switchSubject("全部", { skipUpload: true });
					bindDomEvents();
					applyVariantUI();
				} finally {
					hideLoadingOverlay();
					checkForUpdates();
				}
			})();
		}

		function bindModalBackdropClose(modalEl, closeFunc) {
			if (!modalEl) return;
			let _mouseDownOnBackdrop = false;
			modalEl.addEventListener('mousedown', (e) => {
				_mouseDownOnBackdrop = (e.target === modalEl);
			});
			modalEl.addEventListener('click', (e) => {
				if (_mouseDownOnBackdrop && e.target === modalEl) {
					closeFunc();
				}
				_mouseDownOnBackdrop = false;
			});
		}

		function bindDomEvents() {
			$$('.subject-item').forEach(item => {
				item.addEventListener('click', () => switchSubject(item.dataset.subject));
			});

			bindModalBackdropClose(elements.settingsModal, closeSettings);

			document.addEventListener('click', (event) => {
				if (event.target.classList.contains('tab-btn')) {
					const tab = event.target.dataset.tab;
					switchTab(tab);
				}
			});

			document.addEventListener('focus', (e) => {
				if (e.target.classList.contains('homework-content') || e.target.classList.contains('submit-time') || e.target.classList.contains('estimated-time')) {
					activeInput = e.target;
				}
			}, true);
			document.addEventListener('mousedown', (e) => {
				if (e.target.classList.contains('homework-content') || e.target.classList.contains('submit-time') || e.target.classList.contains('estimated-time')) {
					activeInput = e.target;
				}
			}, true);

			// ESC键退出晚自习模式
			document.addEventListener('keydown', (e) => {
				if (e.key === 'Escape' && eveningStudyActive) {
					exitEveningStudyMode();
				}
			});

			// 监听全屏变化
			document.addEventListener('fullscreenchange', () => {
				if (!document.fullscreenElement && eveningStudyActive) {
					exitEveningStudyMode();
				}
			});

		}

		function switchTab(tab) {
			$$('.tab-btn').forEach(btn => btn.classList.remove('active'));
			$$('.tab-pane').forEach(pane => pane.classList.remove('active'));
			$(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
			$(`#${tab}-tab`).classList.add('active');
		}

		init();

		function initHomeworkData() {
			subjects.forEach(subject => {
				if (subject !== "全部") homeworkData[subject] = { homeworks: [] };
			});
		}
		function ensureHomeworkLockedProperty() {
			subjects.forEach(subject => {
				if (subject !== "全部" && homeworkData[subject]) {
					homeworkData[subject].homeworks.forEach(homework => {
						if (homework.locked === undefined) homework.locked = false;
					});
				}
			});
		}

		async function loadAnnouncement() {
			if (!currentClassBindCode) return [];
			try {
				const row = await fetchSbRow(currentClassBindCode);
				return parseAnnouncement(row && row.announcement);
			} catch (e) {
				return [];
			}
		}
		/* 渲染公告只读显示（纯文本编号格式） */
		function renderAnnouncementContent(items) {
			const contentDiv = document.getElementById('announcement-content');
			if (!contentDiv) return;
			items = items || [];
			contentDiv.dataset.realContent = serializeAnnouncement(items);
			if (items.length === 0) {
				contentDiv.textContent = '暂无公告';
				return;
			}
			contentDiv.textContent = items.map((item, idx) => `${idx + 1}.${item.text}`).join('\n');
		}

		/* 渲染公告编辑列表（快捷选项模板） */
		function renderAnnouncementEditor(items) {
			const editorDiv = document.getElementById('announcement-editor');
			if (!editorDiv) return;
			items = items || [];
			editorDiv.innerHTML = '';
			const list = document.createElement('div');
			list.className = 'options-list ann-edit-list';
			list.id = 'ann-edit-list';
			items.forEach(item => list.appendChild(createAnnouncementItem(item.text)));
			editorDiv.appendChild(list);
			const footer = document.createElement('div');
			footer.className = 'ann-edit-footer';
			const addBtn = document.createElement('button');
			addBtn.className = 'btn btn-success';
			addBtn.textContent = '+ 添加公告';
			addBtn.onclick = addAnnouncementItem;
			const btnGroup = document.createElement('div');
			const doneBtn = document.createElement('button');
			doneBtn.className = 'btn btn-success';
			doneBtn.textContent = '完成';
			doneBtn.onclick = saveAnnouncement;
			const cancelBtn = document.createElement('button');
			cancelBtn.className = 'btn btn-danger';
			cancelBtn.textContent = '取消';
			cancelBtn.onclick = cancelEditAnnouncement;
			btnGroup.appendChild(doneBtn);
			btnGroup.appendChild(cancelBtn);
			footer.appendChild(addBtn);
			footer.appendChild(btnGroup);
			editorDiv.appendChild(footer);
		}

		function createAnnouncementItem(text) {
			const item = document.createElement('div');
			item.className = 'option-item ann-edit-item';
			const ta = document.createElement('textarea');
			ta.className = 'option-input ann-edit-text';
			ta.placeholder = '输入公告内容';
			ta.style.cssText = 'box-sizing:border-box; height:38px; padding:10px 15px; resize:vertical;';
			ta.value = text || '';
			const delBtn = document.createElement('button');
			delBtn.className = 'btn btn-danger delete-option-btn';
			delBtn.textContent = '删除';
			delBtn.onclick = () => deleteAnnouncementItem(delBtn);
			item.appendChild(ta);
			item.appendChild(delBtn);
			return item;
		}

		/* 从编辑器收集当前公告文本数组 */
		function collectAnnouncementItems() {
			const list = document.getElementById('ann-edit-list');
			if (!list) return [];
			const result = [];
			list.querySelectorAll('.ann-edit-text').forEach(el => {
				const text = el.value.trim();
				if (text) result.push({ text: text });
			});
			return result;
		}

		function addAnnouncementItem() {
			const list = document.getElementById('ann-edit-list');
			if (!list) return;
			const item = createAnnouncementItem('');
			list.appendChild(item);
			item.classList.add('fade-in');
			setTimeout(() => item.classList.remove('fade-in'), 10);
			const ta = item.querySelector('.ann-edit-text');
			if (ta) ta.focus();
		}

		function deleteAnnouncementItem(btn) {
			const item = btn.closest('.ann-edit-item');
			if (!item) return;
			item.classList.add('fade-out');
			setTimeout(() => item.remove(), 300);
		}

		function editAnnouncement() {
			if (!currentClassBindCode) return;
			const contentDiv = document.getElementById('announcement-content');
			const editorDiv = document.getElementById('announcement-editor');
			const editButton = document.querySelector('.btn-warning[onclick="editAnnouncement()"]');
			// 从 dataset 读取当前 items
			let items = [];
			if (contentDiv && contentDiv.dataset.realContent) {
				try {
					items = JSON.parse(contentDiv.dataset.realContent) || [];
				} catch (e) { items = []; }
			}
			if (contentDiv) contentDiv.style.display = 'none';
			if (editorDiv) editorDiv.style.display = 'block';
			if (editButton) editButton.style.display = 'none';
			renderAnnouncementEditor(items);
		}

		async function saveAnnouncement() {
			const items = collectAnnouncementItems();
			const contentDiv = document.getElementById('announcement-content');
			const editorDiv = document.getElementById('announcement-editor');
			const editButton = document.querySelector('.btn-warning[onclick="editAnnouncement()"]');

			// 立刻更新UI
			renderAnnouncementContent(items);
			if (contentDiv) contentDiv.style.display = 'block';
			if (editorDiv) editorDiv.style.display = 'none';
			if (editButton) editButton.style.display = 'block';

			// 后台异步保存
			if (!currentClassBindCode) return;
			const client = ensureSupabase();
			if (client) {
				fetchSbRow(currentClassBindCode).then(row => {
					upsertSbRow({
						bind_code: currentClassBindCode,
						class_name: (row && row.class_name) || classSettings.className,
						settings: withAutoDeleteMark(row && row.settings),
						homework_data: (row && row.homework_data) || {},
						announcement: items,
						updated_at: new Date().toISOString()
					});
				});
			}
		}

		function cancelEditAnnouncement() {
			const contentDiv = document.getElementById('announcement-content');
			const editorDiv = document.getElementById('announcement-editor');
			const editButton = document.querySelector('.btn-warning[onclick="editAnnouncement()"]');
			if (contentDiv) contentDiv.style.display = 'block';
			if (editorDiv) editorDiv.style.display = 'none';
			if (editButton) editButton.style.display = 'block';
		}

		function updateHomeworkList() {
			const homeworks = homeworkData[currentSubject].homeworks;
			elements.homeworkList.innerHTML = '';
			homeworks.forEach((homework, index) => {
				const homeworkItem = document.createElement('div');
				homeworkItem.className = `homework-item ${homework.locked ? 'locked' : ''}`;
				homeworkItem.dataset.index = index;
				homeworkItem.innerHTML = `
					<div style="display: flex; gap: 12px; align-items: flex-start;">
						<div style="display: flex; flex-direction: column; gap: 4px;">
							<button class="btn btn-small" onclick="moveHomeworkUp(${index})" ${index === 0 ? 'disabled' : ''}><span style="font-size: 14px;"><i class="fa-solid fa-arrow-up"></i></span></button>
							<button class="btn btn-small" onclick="moveHomeworkDown(${index})" ${index === homeworkData[currentSubject].homeworks.length - 1 ? 'disabled' : ''}><span style="font-size: 14px;"><i class="fa-solid fa-arrow-down"></i></span></button>
							<button class="btn btn-small btn-lock ${homework.locked ? 'locked' : ''}" onclick="toggleHomeworkLock(${index})"><span style="font-size: 14px;">${homework.locked ? '<i class="fa-solid fa-lock"></i>' : '<i class="fa-solid fa-lock-open"></i>'}</span></button>
						</div>
							<textarea class="homework-content" placeholder="作业内容" oninput="updateHomeworkContent(${index}, this.value)">${escapeHtml(homework.content)}</textarea>
							<div style="display: flex; flex-direction: column; width: 118px; gap: 8px;">
								<div>
									<input type="text" class="submit-time" placeholder="提交时间" value="${escapeHtml(homework.submitTime)}" onfocus="showTimeDropdown(this)" onblur="hideTimeDropdown(this, event)" oninput="updateHomeworkSubmitTime(${index}, this.value)" data-index="${index}">
								</div>
								<div style="display: flex; align-items: center; gap: 5px;">
									<input type="text" class="estimated-time" placeholder="预计时间" value="${escapeHtml(homework.estimatedTime || '')}" oninput="updateHomeworkEstimatedTime(${index}, this.value)">
									<span style="font-size: 14px; color: #6b7280;">分钟</span>
								</div>
							</div>
							<button class="btn btn-danger delete-homework-btn" onclick="deleteHomework(${index})"><span style="font-size: 20px;">×</span></button>
						</div>
					`;
				elements.homeworkList.appendChild(homeworkItem);
			});
		}

		function updateHomeworkContent(index, content) {
			homeworkData[currentSubject].homeworks[index].content = content;
		}
		function updateHomeworkSubmitTime(index, submitTime) {
			homeworkData[currentSubject].homeworks[index].submitTime = submitTime;
		}
		function updateHomeworkEstimatedTime(index, estimatedTime) {
			homeworkData[currentSubject].homeworks[index].estimatedTime = estimatedTime;
		}
		function moveHomeworkUp(index) {
			if (index > 0) {
				const hw = homeworkData[currentSubject].homeworks;
				[hw[index], hw[index - 1]] = [hw[index - 1], hw[index]];
				updateHomeworkList();
			}
		}
		function moveHomeworkDown(index) {
			const hw = homeworkData[currentSubject].homeworks;
			if (index < hw.length - 1) {
				[hw[index], hw[index + 1]] = [hw[index + 1], hw[index]];
				updateHomeworkList();
			}
		}
		function toggleHomeworkLock(index) {
			const hw = homeworkData[currentSubject].homeworks[index];
			hw.locked = !hw.locked;
			updateHomeworkList();
		}

		const TimeSelector = {
			dropdowns: new Map(),
			showDropdown(input) {
				let dropdown = this.dropdowns.get(input);
				if (!dropdown) {
					dropdown = document.createElement('div');
					dropdown.className = 'time-dropdown';
					document.body.appendChild(dropdown);
					this.dropdowns.set(input, dropdown);
				}
				this.generateTimeOptions(input, dropdown);
				const rect = input.getBoundingClientRect();
				dropdown.style.left = `${rect.left}px`;
				dropdown.style.top = `${rect.bottom + window.scrollY}px`;
				dropdown.style.width = `${rect.width}px`;
				dropdown.style.display = 'block';
			},
			hideDropdown(input) {
				const d = this.dropdowns.get(input);
				if (d) d.style.display = 'none';
			},
			generateTimeOptions(input, dropdown) {
				dropdown.innerHTML = '';
				globalSettings.timeOptions.forEach(option => {
					const el = document.createElement('div');
					el.className = 'time-option';
					el.textContent = option;
					el.onclick = (e) => {
						e.stopPropagation();
						const idx = parseInt(input.dataset.index);
						homeworkData[currentSubject].homeworks[idx].submitTime = option;
						input.value = option;
						dropdown.style.display = 'none';
					};
					dropdown.appendChild(el);
				});
			}
		};
		function showTimeDropdown(input) { TimeSelector.showDropdown(input); }
		function hideTimeDropdown(input, event) {
			setTimeout(() => {
				const dropdown = TimeSelector.dropdowns.get(input);
				const relatedTarget = event && event.relatedTarget;
				if (!relatedTarget || (dropdown && !dropdown.contains(relatedTarget))) TimeSelector.hideDropdown(input);
			}, 100);
		}

		function addHomework() {
			homeworkData[currentSubject].homeworks.push({ content: "", estimatedTime: "", submitTime: "", locked: false });
			updateHomeworkList();
			const items = elements.homeworkList.querySelectorAll('.homework-item');
			const last = items[items.length - 1];
			if (last) {
				last.classList.add('fade-in');
				void last.offsetWidth;
				last.classList.remove('fade-in');
				const inp = last.querySelector('.homework-content');
				if (inp) inp.focus();
			}
		}
		function deleteHomework(index) {
			const hw = homeworkData[currentSubject].homeworks[index];
			if (hw.locked && !confirm('此作业项已锁定，确定要删除吗？')) return;
			const item = elements.homeworkList.children[index];
			if (item) item.classList.add('fade-out');
			setTimeout(() => {
				homeworkData[currentSubject].homeworks.splice(index, 1);
				updateHomeworkList();
			}, 300);
		}

		function generateExportContent() {
			const exportContent = document.createElement('div');
			exportContent.style.backgroundColor = '#ffffff';
			exportContent.style.color = '#000000';
			exportContent.style.fontFamily = "'Microsoft YaHei', '微软雅黑', sans-serif";
			exportContent.style.fontSize = `${classSettings.exportFontSize}px`;
			exportContent.style.lineHeight = '1';
			exportContent.style.textAlign = 'left';

			const titleDiv = document.createElement('div');
			titleDiv.style.fontSize = `${classSettings.exportFontSize * 1.1}px`;
			titleDiv.style.marginBottom = `${classSettings.exportFontSize * 0.3}px`;
			titleDiv.style.textAlign = 'left';

			let titleContent = escapeHtml(classSettings.exportTitle);
			if (classSettings.exportAddDate) {
				const currentDate = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
				titleContent += ` <span style="font-size: ${classSettings.exportFontSize * 0.8}px; font-weight: normal; color: #666666;">${currentDate}</span>`;
			}
			titleDiv.innerHTML = titleContent;
			exportContent.appendChild(titleDiv);

			const contentDiv = document.createElement('div');
			contentDiv.style.textAlign = 'left';
			contentDiv.style.fontSize = `${classSettings.exportFontSize}px`;
			contentDiv.style.lineHeight = '1';
			
			// 科目缩写映射
			const subjectAbbreviations = {
				"语文": "语",
				"数学": "数",
				"英语": "英",
				"物理": "物",
				"化学": "化",
				"政治": "政",
				"历史": "史",
				"生物": "生",
				"地理": "地",
				"其他": "另"
			};
			
			subjects.forEach(subject => {
				if (subject !== "全部") {
					const subjectData = homeworkData[subject];
					const validHomeworks = subjectData.homeworks.filter(hw => hw.content.trim() !== "");
					
					if (validHomeworks.length > 0) {
						// 获取科目标题（使用缩写）
						let subjectTitle = subjectAbbreviations[subject] || subject;
						const subjectColorIndex = subjects.indexOf(subject);
						
						// 为每个科目创建一个容器
						const subjectLines = [];
						
						// 处理每个作业项
						validHomeworks.forEach((homework, index) => {
							const homeworkNumber = index + 1;
							const contentLines = homework.content.split('\n');
							
							// 为作业创建行
							contentLines.forEach((line, lineIndex) => {
								let displayLine = '';
								
								if (lineIndex === 0) {
									// 第一行
									if (index === 0) {
										// 第一项作业第一行
										displayLine = `<strong class="sc-${subjectColorIndex}">${escapeHtml(subjectTitle)}：</strong>${homeworkNumber}.${escapeHtml(line)}`;
									} else {
										// 后续作业第一行
										displayLine = `&thinsp;&thinsp;&thinsp;&thinsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${homeworkNumber}.${escapeHtml(line)}`;
									}
								} else {
									// 后续行
									displayLine = `&thinsp;&thinsp;&thinsp;&thinsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${escapeHtml(line)}`;
								}
								
								// 检查是否为最后一行
								if (lineIndex === contentLines.length - 1) {
									// 最后一行：添加提交时间和预计时间
									let timeElements = '';
									if (homework.submitTime) {
										timeElements += `<span class="preview-time sc-${subjectColorIndex}" style="font-size: ${classSettings.exportFontSize * 0.8}px; margin-left: ${classSettings.exportFontSize * 0.2}px; padding: ${classSettings.exportFontSize * 0.15}px ${classSettings.exportFontSize * 0.35}px; border-radius: ${classSettings.exportFontSize * 0.25}px; top: ${classSettings.exportFontSize * -0.1}px;">${escapeHtml(homework.submitTime)}</span>`;
									}
									if (homework.estimatedTime) {
										timeElements += `<span class="preview-time sc-${subjectColorIndex}" style="font-size: ${classSettings.exportFontSize * 0.8}px; margin-left: ${classSettings.exportFontSize * 0.2}px; padding: ${classSettings.exportFontSize * 0.15}px ${classSettings.exportFontSize * 0.35}px; border-radius: ${classSettings.exportFontSize * 0.25}px; top: ${classSettings.exportFontSize * -0.1}px;">${escapeHtml(homework.estimatedTime)}&thinsp;分钟</span>`;
									}
									
									if (timeElements) {
										displayLine += timeElements;
									}
								}
								
								subjectLines.push(displayLine);
							});
						});
						
						// 将科目行转换为HTML
						const subjectHtml = subjectLines.map(line => `<div>${line}</div>`).join('');
						const subjectDiv = document.createElement('div');
						subjectDiv.className = 'preview-subject';
						subjectDiv.innerHTML = subjectHtml;
						subjectDiv.style.marginBottom = `${classSettings.exportFontSize * 0.2}px`;
						subjectDiv.style.gap = `${classSettings.exportFontSize * 0.2}px`;
						contentDiv.appendChild(subjectDiv);
					}
				}
			});
			
			exportContent.appendChild(contentDiv);
			
			// 设置图片宽度随内容动态调整
			const images = exportContent.querySelectorAll('img');
			images.forEach(img => {
				img.style.maxWidth = '100%';
				img.style.height = 'auto';
			});
			
			return exportContent;
		}

		// 更新预览
		function updatePreview() {
			elements.previewSubjects.innerHTML = '';

			if (!currentClassBindCode) {
				const tip = document.createElement('div');
				tip.className = 'preview-empty';
				tip.innerHTML = '<i class="fa-solid fa-link"></i>'
					+ '<div class="preview-empty-title">尚未绑定班级</div>'
					+ '<div class="preview-empty-desc">打开右上角「设置」→「绑定」，填入绑定码后即可在这里查看作业</div>';
				elements.previewSubjects.appendChild(tip);
				return;
			}

			// 使用统一的生成函数创建预览内容
			const exportContent = generateExportContent();
			elements.previewSubjects.appendChild(exportContent);
		}

		// 导出为图片
		async function renderAndDownloadPNG(fileName) {
			const exportArea = elements.exportArea;
			exportArea.innerHTML = '';
			exportArea.style.position = 'fixed';
			exportArea.style.left = '-9999px';
			exportArea.style.top = '0';
			exportArea.style.display = 'block';

			const exportContent = generateExportContent();
			exportContent.style.width = 'auto';
			exportContent.style.maxWidth = 'none';
			exportArea.appendChild(exportContent);

			await new Promise(resolve => setTimeout(resolve, 100));

			try {
				const contentWidth = exportContent.scrollWidth;
				const contentHeight = exportContent.scrollHeight;
				const canvas = await html2canvas(exportContent, {
					scale: 2, useCORS: true,
					width: contentWidth, height: contentHeight,
					x: 0, y: 0, backgroundColor: '#ffffff'
				});
				const link = document.createElement('a');
				link.download = fileName;
				link.href = canvas.toDataURL();
				link.click();
				return true;
			} catch (error) {
				console.error('导出图片失败:', error);
				return false;
			} finally {
				exportArea.style.display = 'none';
				exportArea.style.position = '';
				exportArea.style.left = '';
				exportArea.style.top = '';
			}
		}

		async function exportToImage() {
			const ok = await renderAndDownloadPNG(`${new Date().toISOString().split('T')[0]}.png`);
			if (!ok) alert('导出图片失败，请重试');
		}

		// 清空所有作业
		function clearAllHomework() {
			if (confirm('确定要清空所有科目的作业吗？此操作不可恢复。（锁定的作业项将被保留）')) {
				// 保存锁定的作业项
				const lockedHomeworks = {};
				subjects.forEach(subject => {
					if (subject !== "全部" && homeworkData[subject]) {
						lockedHomeworks[subject] = {
							homeworks: homeworkData[subject].homeworks.filter(homework => homework.locked)
						};
					}
				});
				
				// 执行清空数据和恢复锁定项的操作
				const doClear = async () => {
					initHomeworkData();
					// 恢复锁定的作业项
					subjects.forEach(subject => {
						if (subject !== "全部" && lockedHomeworks[subject]) {
							homeworkData[subject] = lockedHomeworks[subject];
						}
					});

					// 上传前最后从云端取一次数据，发现变更则交给用户决定
					const v = await verifyCloudBeforeUpload();
					if (!v.ok) {
						if (v.readFailed) {
							alert('无法读取云端数据（' + lastSbError + '），为避免覆盖云端内容，本次上传已取消。\n请检查网络后重试。');
							return;
						}
						showSaveConflictWarning(() => uploadHomeworkToSb());
						return;
					}
					// 上传到云端
					uploadHomeworkToSb(v.row);
				};
				
				// 如果当前是编辑模式，添加淡出动画
				if (currentSubject !== "全部") {
					const homeworkItems = elements.homeworkList.querySelectorAll('.homework-item');
					homeworkItems.forEach(item => {
						item.classList.add('fade-out');
					});
					
					// 等待动画完成后清空数据
					setTimeout(() => {
						doClear();
						updateHomeworkList();
						updatePreview();
					}, 300);
				} else {
					// 如果当前是预览模式，添加淡出动画
					const subjectItems = elements.previewSubjects.querySelectorAll('.preview-subject');
					subjectItems.forEach(item => {
						item.style.transition = 'all 0.3s ease';
						item.style.opacity = '0';
						item.style.transform = 'translateY(-10px)';
					});
					
					// 等待动画完成后清空数据
					setTimeout(() => {
						doClear();
						updatePreview();
					}, 300);
				}
			}
		}

		function updateShortcutSidebar() {
			if (currentSubject === "全部") return;
			const sidebar = document.querySelector('.shortcut-sidebar');
			if (!sidebar) return;
			const shortcutItems = sidebar.querySelectorAll('.shortcut-item');
			shortcutItems.forEach(item => item.remove());
			const shortcutTitle = sidebar.querySelector('.shortcut-title');
			globalSettings.shortcuts.forEach(shortcut => {
				const shortcutItem = document.createElement('div');
				shortcutItem.className = 'shortcut-item';
				shortcutItem.dataset.text = shortcut;
				shortcutItem.textContent = shortcut;
				shortcutItem.onclick = function() {
					const text = this.dataset.text;
					if (activeInput) {
						const start = activeInput.selectionStart;
						const end = activeInput.selectionEnd;
						const currentValue = activeInput.value;
						const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);
						activeInput.value = newValue;
						const newPosition = start + text.length;
						activeInput.setSelectionRange(newPosition, newPosition);
						activeInput.focus();
						const inputEvent = new Event('input');
						activeInput.dispatchEvent(inputEvent);
					}
				};
				sidebar.appendChild(shortcutItem);
			});
		}

		/* ==================== 深色/浅色模式 ==================== */
		function initTheme() {
			const saved = localStorage.getItem('homeworkManagerTheme') || 'light';
			document.body.setAttribute('data-theme', saved);
		}
		function toggleTheme() {
			const cur = document.body.getAttribute('data-theme') || 'light';
			const next = cur === 'dark' ? 'light' : 'dark';
			document.body.setAttribute('data-theme', next);
			localStorage.setItem('homeworkManagerTheme', next);
		}

		/* ==================== 晚自习模式 ==================== */
		let eveningStudyActive = false;
		let eveningStudyTimeInterval = null;

		function toggleEveningStudyMode() {
			if (eveningStudyActive) { exitEveningStudyMode(); }
			else { enterEveningStudyMode(); }
		}

		function renderEveningStudyContent() {
			const overlay = document.getElementById('evening-study-overlay');
			const contentDiv = document.getElementById('evening-study-content');
			if (!overlay || !contentDiv) return;

			/* 临时显示overlay（不可见）以便浏览器正确渲染和测量尺寸 */
			overlay.style.visibility = 'hidden';
			overlay.classList.add('active');
			/* 测量期间移除内容区的尺寸限制，确保获取真实内容尺寸 */
			contentDiv.style.maxWidth = 'none';
			contentDiv.style.maxHeight = 'none';
			contentDiv.style.overflow = 'visible';

			const originalFontSize = classSettings.exportFontSize;
			/* 可用空间 = 全屏分辨率 - overlay padding(10*2) - content padding(15*2) - 安全边距(10) */
			const sw = screen.width || window.innerWidth;
			const sh = screen.height || window.innerHeight;
			const availWidth = sw - 60;
			const availHeight = sh - 60;
			let best = 20;
			const minSize = 20, maxSize = 80;

			/* 二分法查找不溢出画面的最大字号（约6次迭代） */
			let lo = minSize, hi = maxSize;
			while (lo <= hi) {
				const mid = Math.floor((lo + hi) / 2);
				classSettings.exportFontSize = mid;
				const testContent = generateExportContent();
				contentDiv.innerHTML = '';
				contentDiv.appendChild(testContent);
				/* 约束内容宽度，让文字自然换行，主要检测高度溢出 */
				testContent.style.maxWidth = availWidth + 'px';
				testContent.style.width = 'auto';
				if (testContent.offsetHeight <= availHeight) {
					best = mid;   /* 不溢出，记录并尝试更大字号 */
					lo = mid + 1;
				} else {
					hi = mid - 1; /* 溢出，尝试更小字号 */
				}
			}

			/* 用最佳字号生成最终内容 */
			classSettings.exportFontSize = best;
			const finalContent = generateExportContent();
			contentDiv.innerHTML = '';
			contentDiv.appendChild(finalContent);
			finalContent.style.maxWidth = availWidth + 'px';
			classSettings.exportFontSize = originalFontSize;

			/* 恢复内容区样式（保持maxWidth/maxHeight为none避免CSS限制裁剪内容） */
			contentDiv.style.maxWidth = 'none';
			contentDiv.style.maxHeight = 'none';
			contentDiv.style.overflow = '';

			/* 恢复可见性 */
			overlay.style.visibility = '';
		}

		function enterEveningStudyMode() {
			const overlay = document.getElementById('evening-study-overlay');
			const contentDiv = document.getElementById('evening-study-content');
			if (!overlay || !contentDiv) return;
			eveningStudyActive = true;

			renderEveningStudyContent();

			/* 请求全屏 */
			const el = document.documentElement;
			if (el.requestFullscreen) { el.requestFullscreen().catch(() => {}); }
			else if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); }

			/* 启动北京时间 */
			updateBeijingTime();
			eveningStudyTimeInterval = setInterval(updateBeijingTime, 1000);
		}

		/* 晚自习模式开启时，实时收到作业更改后刷新其内容 */
		function refreshEveningStudy() {
			if (eveningStudyActive) {
				renderEveningStudyContent();
			}
		}

		function exitEveningStudyMode() {
			const overlay = document.getElementById('evening-study-overlay');
			if (overlay) overlay.classList.remove('active');
			eveningStudyActive = false;
			if (eveningStudyTimeInterval) { clearInterval(eveningStudyTimeInterval); eveningStudyTimeInterval = null; }
			if (document.fullscreenElement || document.webkitFullscreenElement) {
				if (document.exitFullscreen) { document.exitFullscreen().catch(() => {}); }
				else if (document.webkitExitFullscreen) { document.webkitExitFullscreen(); }
			}
		}

		function updateBeijingTime() {
			const clockEl = document.getElementById('es-clock');
			const dateEl = document.getElementById('es-date');
			const now = new Date();
			if (clockEl) {
				clockEl.textContent = now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
			}
			if (dateEl) {
				const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).formatToParts(now);
				const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
				dateEl.textContent = `${get('year')}年${get('month')}${get('day')}日 ${get('weekday')}`;
			}
		}

		/* ==================== 公告 JSON 系统 ==================== */
		function parseAnnouncement(raw) {
			if (!raw || !Array.isArray(raw)) return [];
			return raw
				.map(item => ({ text: typeof item === 'string' ? item : (item && item.text) }))
				.filter(item => typeof item.text === 'string' && item.text.trim() !== '');
		}

		function serializeAnnouncement(items) {
			return JSON.stringify(items || []);
		}

		/* ==================== 导出 ==================== */
		function handleExport() {
			exportToImage();
		}