		(function ensureFontAwesome() {
			var FA_HREF = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
			setTimeout(function () {
				try {
					var loaded = Array.prototype.some.call(document.styleSheets || [], function (s) {
						return !!s.href && s.href.indexOf('font-awesome') !== -1;
					});
					if (loaded) return;
					var old = document.querySelector('link[href*="font-awesome"]');
					if (!old || !old.parentNode) return;
					var link = document.createElement('link');
					link.rel = 'stylesheet';
					link.href = FA_HREF;
					old.parentNode.insertBefore(link, old.nextSibling);
					old.parentNode.removeChild(old);
					console.warn('[FontAwesome] CORS 模式加载失败，已降级为普通模式');
				} catch (e) {}
			}, 2000);
		})();

		const $ = (selector) => document.querySelector(selector);
		const $$ = (selector) => document.querySelectorAll(selector);

		const elements = {
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
			"appName": "作业管理器（本地）",
			"version": "v3.2.0"
		};

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
			className: "我的班级",
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


		const LS_KEYS = {
				global: "homeworkManagerGlobalSettings",
				classData: "homeworkManagerClassData"
			};

		function autoDeleteLastRunKey() {
			return "homeworkManagerAutoDeleteLastRun";
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

		/* ==================== 本地数据存储层（单班级） ====================
		本地仅维护一个班级：班级设置 / 作业内容 / 公告 全部保存在 localStorage，
		无需绑定码、无需联网。 */

		function fetchClassRow() {
			const row = getLocal(LS_KEYS.classData, null);
			return row && typeof row === "object" ? row : null;
		}

		function saveClassRow(row) {
			if (!row) return null;
			row.updated_at = new Date().toISOString();
			setLocal(LS_KEYS.classData, row);
			return row;
		}

		/* 迁移：旧版按绑定码分班的数据，自动搬进单班级存储槽 */
		function migrateLegacyClassData() {
			if (getLocal(LS_KEYS.classData, null)) return;
			const prefix = LS_KEYS.classData + "_";
			let legacy = null;
			try {
				for (let i = 0; i < localStorage.length; i++) {
					const k = localStorage.key(i);
					if (k && k.indexOf(prefix) === 0) {
						const v = getLocal(k, null);
						if (v && typeof v === "object" && (v.homework_data || v.settings || v.class_name)) { legacy = v; break; }
					}
				}
			} catch (e) { /* ignore */ }
			if (!legacy) return;
			delete legacy.bind_code;
			setLocal(LS_KEYS.classData, legacy);
		}

		function fetchClassSettings() {
			const row = fetchClassRow();
			if (!row) return {...DEFAULT_CLASS_SETTINGS};
			const s = row.settings || {};
			return {
				className: row.class_name || (s.className || DEFAULT_CLASS_SETTINGS.className),
				exportTitle: s.exportTitle ?? DEFAULT_CLASS_SETTINGS.exportTitle,
				exportAddDate: s.exportAddDate ?? DEFAULT_CLASS_SETTINGS.exportAddDate,
				exportFontSize: s.exportFontSize ?? DEFAULT_CLASS_SETTINGS.exportFontSize,
				autoDeleteDaily: s.autoDeleteDaily ?? DEFAULT_CLASS_SETTINGS.autoDeleteDaily
			};
		}


		function loadGlobalSettings() {
			const g = getLocal(LS_KEYS.global, null);
			if (g) globalSettings = {...DEFAULT_GLOBAL_SETTINGS, ...g};
		}
		function saveGlobalSettings() {
			setLocal(LS_KEYS.global, globalSettings);
		}

		async function applyCurrentClass(reloadHomework) {
			const s = fetchClassSettings();
			if (s) classSettings = {...DEFAULT_CLASS_SETTINGS, ...s};
			if (reloadHomework) await reloadHomeworkForCurrentClass();
			if (reloadHomework) {
				await runDailyAutoDeleteIfNeeded();
			}
			updatePreview();
			updateClassSettingsUI();
			const contentDiv = document.getElementById('announcement-content');
			if (contentDiv) {
				const items = await loadAnnouncement();
				renderAnnouncementContent(items);
			}
		}

		async function reloadHomeworkForCurrentClass() {
			initHomeworkData();
			const row = fetchClassRow();
			const hw = (row && row.homework_data) || {};
			subjects.forEach(subject => {
				if (subject !== "全部") {
					homeworkData[subject] = hw[subject] || { homeworks: [] };
					if (!homeworkData[subject].homeworks) homeworkData[subject].homeworks = [];
				}
			});
			ensureHomeworkLockedProperty();
		}

		/* 把当前班级的全部数据写入本地存储 */
		async function saveClassData() {
			const row = fetchClassRow();
			saveClassRow({
				class_name: classSettings.className || (row && row.class_name) || DEFAULT_CLASS_SETTINGS.className,
				settings: {
					...((row && row.settings) || {}),
					exportTitle: classSettings.exportTitle,
					exportAddDate: !!classSettings.exportAddDate,
					exportFontSize: Number(classSettings.exportFontSize) || DEFAULT_CLASS_SETTINGS.exportFontSize,
					autoDeleteDaily: !!classSettings.autoDeleteDaily
				},
				homework_data: homeworkData,
				announcement: (row && row.announcement) || [],
				updated_at: new Date().toISOString()
			});
			refreshEveningStudy();
		}

		/* ==================== 本地自动保存 ==================== */
		let autoSaveTimer = null;

		/* 合并短时间内的连续改动，避免频繁写 localStorage */
		function scheduleAutoSave() {
			if (autoSaveTimer) clearTimeout(autoSaveTimer);
			autoSaveTimer = setTimeout(() => { autoSaveTimer = null; saveClassData(); }, 400);
		}

		/* 立即落盘（改动确认、离开页面时调用） */
		function flushAutoSave() {
			if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
			saveClassData();
		}

		/* ==================== 班级设置：改动即存 ==================== */
		/* 从表单读取班级设置（已去掉「保存」按钮，改动即写入本地） */
		function readClassSettingsFromUI() {
			const etEl = document.getElementById("cls-export-title");
			const efEl = document.getElementById("cls-export-font-size");
			const eaEl = document.getElementById("cls-export-add-date");
			const adEl = document.getElementById("cls-auto-delete-daily");
			return {
				exportTitle: (etEl && etEl.value.trim()) || "作业",
				exportFontSize: parseInt(efEl && efEl.value) || DEFAULT_CLASS_SETTINGS.exportFontSize,
				exportAddDate: !!(eaEl && eaEl.checked),
				autoDeleteDaily: !!(adEl && adEl.checked)
			};
		}

		/* immediate=true 立即落盘（复选框），否则走防抖（输入框连续输入） */
		function applyClassSettingsFromUI(immediate) {
			classSettings = { ...classSettings, ...readClassSettingsFromUI() };
			updatePreview();
			if (immediate) flushAutoSave();
			else scheduleAutoSave();
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

		function updateClassSettingsUI() {
			const et = document.getElementById("cls-export-title");
			const ef = document.getElementById("cls-export-font-size");
			const ea = document.getElementById("cls-export-add-date");
			const ad = document.getElementById("cls-auto-delete-daily");

			if (et) et.value = classSettings.exportTitle || "";
			if (ef) ef.value = classSettings.exportFontSize ?? "";
			if (ea) ea.checked = !!classSettings.exportAddDate;
			if (ad) ad.checked = !!classSettings.autoDeleteDaily;
		}

		function openSettings() {
			loadGlobalSettings();
			applyCurrentClass(false);
			updateClassSettingsUI();
			generateShortcutOptionsList();
			generateTimeOptionsList();
			generateImportantDatesList();
			elements.settingsModal.classList.add('active');
		}

		function closeSettings() {
			flushAutoSave();          // 关闭设置前把待写入的设置项落盘
			elements.settingsModal.classList.remove('active');
		}

		function openAbout() {
			document.getElementById('about-modal').classList.add('active');
		}

		function closeAbout() {
			document.getElementById('about-modal').classList.remove('active');
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

		async function switchSubject(subject) {
			currentSubject = subject;
			$$('.subject-item').forEach(item => item.classList.remove('active'));
			const activeItem = document.querySelector(`.subject-item[data-subject="${subject}"]`);
			if (activeItem) activeItem.classList.add('active');

			if (subject === "全部") {
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
								<button class="btn btn-warning" onclick="editAnnouncement()" style="flex-shrink: 0; white-space: nowrap;">编辑</button>
							</div>
							<div id="announcement-content" style="font-size: 20px; line-height: 1.2; min-height: 200px;word-wrap: break-word; word-break: break-word; overflow-wrap: break-word; white-space: pre-wrap;"></div>
							<div id="announcement-editor" style="display: none; margin-top: 12px;"></div>
						`;
					}
				}
				
				updatePreview();
				// 加载公告
				loadAnnouncement().then(items => {
					renderAnnouncementContent(items);
				});
				// 保存班级数据到本地
				saveClassData();
			} else {
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
			migrateLegacyClassData();
			applyVariantUI();

			initHomeworkData();

			(async () => {
				try {
					await applyCurrentClass(true);
					startImportantDateScroll();
					await switchSubject("全部");
					bindDomEvents();
					applyVariantUI();
				} finally {
					hideLoadingOverlay();
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

		/* ----- 事件 target 安全访问 -----
		   focus / mousedown / click 的 target 并不总是元素节点：
		   窗口切换、焦点落空时 target 可能是 document / window，
		   此时 classList 为 undefined，直接 .contains() 会抛 TypeError。 */
		function hasAnyClass(el, classNames) {
			if (!el || !el.classList || typeof el.classList.contains !== 'function') return false;
			return classNames.some(function (c) { return el.classList.contains(c); });
		}
		function safeClosest(el, selector) {
			if (!el || typeof el.closest !== 'function') return null;
			return el.closest(selector);
		}

		function bindDomEvents() {
			$$('.subject-item').forEach(item => {
				item.addEventListener('click', () => switchSubject(item.dataset.subject));
			});

			bindModalBackdropClose(elements.settingsModal, closeSettings);

			document.addEventListener('click', (event) => {
				// 用 closest 兼容点到按钮内部 <i> 图标的情况
				const tabBtn = safeClosest(event.target, '.tab-btn');
				if (tabBtn) {
					switchTab(tabBtn.dataset.tab);
				}
			});

			document.addEventListener('focus', (e) => {
				if (hasAnyClass(e.target, ['homework-content', 'submit-time', 'estimated-time'])) {
					activeInput = e.target;
				}
			}, true);
			document.addEventListener('mousedown', (e) => {
				if (hasAnyClass(e.target, ['homework-content', 'submit-time', 'estimated-time'])) {
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

			// 离开页面 / 切到后台时，把待写入的改动立即落盘
			window.addEventListener('beforeunload', flushAutoSave);
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'hidden') flushAutoSave();
			});

		}

		function switchTab(tab) {
			$$('.tab-btn').forEach(btn => btn.classList.remove('active'));
			$$('.tab-pane').forEach(pane => pane.classList.remove('active'));
			$(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
			$(`#${tab}-tab`).classList.add('active');
		}

		init();

		function todayKey() {
			const d = new Date();
			return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
		}

		async function runDailyAutoDeleteIfNeeded() {
			const enabled = !!classSettings.autoDeleteDaily;
			if (!enabled) return;
			const today = todayKey();
			const lastRun = localStorage.getItem(autoDeleteLastRunKey());
			if (lastRun === today) return;
			subjects.forEach(subject => {
				if (subject === "全部" || !homeworkData[subject]) return;
				homeworkData[subject].homeworks = homeworkData[subject].homeworks.filter(hw => hw.locked);
			});
			localStorage.setItem(autoDeleteLastRunKey(), today);
			saveClassData();
		}

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
			try {
				const row = fetchClassRow();
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
			addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> 添加公告';
			addBtn.onclick = addAnnouncementItem;
			const btnGroup = document.createElement('div');
			const doneBtn = document.createElement('button');
			doneBtn.className = 'btn btn-success';
			doneBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> 完成';
			doneBtn.onclick = saveAnnouncement;
			const cancelBtn = document.createElement('button');
			cancelBtn.className = 'btn btn-danger';
			cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i> 取消';
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
			delBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i> 删除';
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

			// 保存到本地
			const row = fetchClassRow();
			saveClassRow({
				class_name: (row && row.class_name) || classSettings.className,
				settings: (row && row.settings) || {},
				homework_data: (row && row.homework_data) || {},
				announcement: items,
				updated_at: new Date().toISOString()
			});
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
			scheduleAutoSave();
		}
		function updateHomeworkSubmitTime(index, submitTime) {
			homeworkData[currentSubject].homeworks[index].submitTime = submitTime;
			scheduleAutoSave();
		}
		function updateHomeworkEstimatedTime(index, estimatedTime) {
			homeworkData[currentSubject].homeworks[index].estimatedTime = estimatedTime;
			scheduleAutoSave();
		}
		function moveHomeworkUp(index) {
			if (index > 0) {
				const hw = homeworkData[currentSubject].homeworks;
				[hw[index], hw[index - 1]] = [hw[index - 1], hw[index]];
				scheduleAutoSave();
				updateHomeworkList();
			}
		}
		function moveHomeworkDown(index) {
			const hw = homeworkData[currentSubject].homeworks;
			if (index < hw.length - 1) {
				[hw[index], hw[index + 1]] = [hw[index + 1], hw[index]];
				scheduleAutoSave();
				updateHomeworkList();
			}
		}
		function toggleHomeworkLock(index) {
			const hw = homeworkData[currentSubject].homeworks[index];
			hw.locked = !hw.locked;
			scheduleAutoSave();
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
						scheduleAutoSave();
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
			scheduleAutoSave();
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
				scheduleAutoSave();
				updateHomeworkList();
			}, 300);
		}

		function generateExportContent() {
			const exportContent = document.createElement('div');
			exportContent.style.backgroundColor = '#ffffff';
			exportContent.style.color = '#000000';
			exportContent.style.fontFamily = "'Times New Roman', 'SimSun', '宋体', serif";
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
		function hasAnyHomework() {
			return subjects.some(subject => {
				if (subject === "全部" || !homeworkData[subject] || !homeworkData[subject].homeworks) return false;
				return homeworkData[subject].homeworks.some(hw => hw.content && hw.content.trim() !== "");
			});
		}

		// 更新预览
		function updatePreview() {
			elements.previewSubjects.innerHTML = '';

			if (!hasAnyHomework()) {
				const tip = document.createElement('div');
				tip.className = 'preview-empty';
				tip.innerHTML = '<i class="fa-solid fa-clipboard-list"></i>'
					+ '<div class="preview-empty-title">暂无作业</div>'
					+ '<div class="preview-empty-desc">点击左侧任意科目进入编辑模式，添加作业项后回到「全部」即可在此查看</div>';
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
				const doClear = () => {
					initHomeworkData();
					// 恢复锁定的作业项
					subjects.forEach(subject => {
						if (subject !== "全部" && lockedHomeworks[subject]) {
							homeworkData[subject] = lockedHomeworks[subject];
						}
					});

					// 保存到本地
					saveClassData();
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
				const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'long' }).formatToParts(now);
				const get = (t) => (parts.find(p => p.type === t) || {}).value || '';
				dateEl.textContent = `${get('year')}年${get('month')}月${get('day')}日 ${get('weekday')}`;
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
	