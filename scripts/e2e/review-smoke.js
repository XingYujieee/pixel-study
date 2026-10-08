// 用 playwright-cli run-code --filename=scripts/e2e/review-smoke.js 执行。
// 前提：开发服务器运行在 1427，页面已加载 mock-tauri.js（见测试报告）。
async (page) => {
  await page.reload();
  await page.getByRole("button", { name: "点击画面进入书房" }).waitFor();
  const results = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); results.push(name); };
  const open = async (kind) => {
    await page.evaluate(async (kind) => {
      const { useWorld } = await import("/src/app/worldStore.ts");
      useWorld.getState().openGui({ kind });
    }, kind);
  };
  await page.evaluate(async () => {
    const { goToFloor } = await import("/src/app/floors.ts");
    await goToFloor("一楼");
  });

  await open("pets");
  await page.getByRole("button", { name: "兔子", exact: true }).click();
  await page.getByPlaceholder("给它起个名字（默认叫「兔子」）").fill("测试兔");
  await page.getByRole("button", { name: "领养", exact: true }).click();
  check(await page.evaluate(async () => (await import("/src/app/worldStore.ts")).useWorld.getState().layout.pets.some(p => p.name === "测试兔")), "宠物领养");

  await open("presets");
  await page.getByPlaceholder("给现在的摆法起个名字").fill("验收摆法");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "换成这套", exact: true }).click();
  await page.getByRole("button", { name: "确定换成这套", exact: true }).click();
  check(await page.evaluate(async () => (await import("/src/app/study.ts")).useStudy.getState().presets.length >= 2), "布局预设保存、载入前备份");

  await open("sound");
  await page.getByRole("checkbox", { name: "全部静音", exact: true }).check();
  check(await page.evaluate(async () => (await import("/src/app/study.ts")).useStudy.getState().volumes.muted), "声音静音设置");
  await page.getByRole("checkbox", { name: "全部静音", exact: true }).uncheck();

  for (const recipe of [
    ["笔记本 Markdown · 与 Obsidian 互通", "回归Markdown", "md"],
    ["纸条 纯文本 .txt", "回归TXT", "txt"],
    ["W Word 文档 .docx · 可用 Word 打开", "回归Word", "docx"],
  ]) {
    await open("workbench");
    await page.getByRole("button", { name: recipe[0], exact: true }).click();
    await page.getByRole("textbox", { name: "书名" }).fill(recipe[1]);
    await page.getByRole("button", { name: "制作并开始写", exact: true }).click();
    await page.getByRole("button", { name: "全屏专注", exact: true }).waitFor();
    if (recipe[2] === "docx") {
      // Word 编辑区没有 ARIA textbox；通过源代码中的 contenteditable 选择。
      await page.locator(".word-page").click();
      await page.keyboard.type("中文 Word 验证");
    } else {
      await page.getByRole("textbox").click();
      await page.keyboard.type("中文编辑验证");
    }
    await page.keyboard.press("Meta+s");
    await page.getByText(/^已保存/).first().waitFor();
    check(await page.evaluate((p) => p in window.__MOCK_FILES__, `Notes/${recipe[1]}.${recipe[2]}`), `${recipe[2]} 新建、编辑和保存`);
  }

  await open("workbench");
  await page.getByRole("textbox", { name: "书名" }).fill("根书架回归");
  await page.getByRole("combobox", { name: "放到", exact: true }).selectOption({ label: "库根目录（文件夹：根目录）" });
  await page.getByRole("button", { name: "制作并开始写", exact: true }).click();
  await page.getByRole("button", { name: "全屏专注", exact: true }).waitFor();
  check(await page.evaluate(() => "根书架回归.md" in window.__MOCK_FILES__), "库根目录书架新建路径");

  await open("pond");
  await page.getByRole("button", { name: "放生", exact: true }).first().click();
  check(await page.evaluate(() => Object.keys(window.__MOCK_FILES__).some(p => p.startsWith(".trash/"))), "灵感放生移到回收站");
  await page.getByRole("button", { name: "撤销", exact: true }).first().click();
  check(!(await page.evaluate(() => Object.keys(window.__MOCK_FILES__).some(p => p.startsWith(".trash/")))), "灵感放生撤销");

  // 导入动作使用真实前端分流及撤销代码，文件 IO 为项目自带模拟后端。
  check(await page.evaluate(async () => {
    window.__MOCK_EXTERNAL__ = { "/outside/验证.pdf": "%PDF-fixture" };
    const { importPaths, undoImport, useImport } = await import("/src/app/importer.ts");
    const { planDrop } = await import("/src/study/dropPlan.ts");
    const paths = await importPaths(["/outside/验证.pdf"], planDrop(null, { focus: true }));
    if (paths.length !== 1 || !window.__MOCK_FILES__[paths[0]]) return false;
    await undoImport(useImport.getState().receipt);
    return !(paths[0] in window.__MOCK_FILES__) && window.__MOCK_EXTERNAL__["/outside/验证.pdf"] === "%PDF-fixture";
  }), "文件导入与撤销（模拟 IO）");

  // 各功能面板的挂载与销毁冒烟，单独列出，不能代替原生或视听验收。
  for (const kind of ["window", "ai", "chest", "wallpick", "jukebox", "help", "butler", "floors", "theme"]) {
    await open(kind);
    await page.locator(".mc-panel, .butler-panel").first().waitFor();
    check((await page.locator("body").innerText()).length > 20, `${kind} 面板渲染`);
  }
  await open("butler");
  await page.getByPlaceholder("试试：三体在哪 / 整理书架 / 种三棵树 / 除草").fill("三体在哪");
  await page.getByRole("button", { name: "说", exact: true }).click();
  await page.locator(".bmsg.from-bird").first().waitFor();
  check((await page.locator(".bmsg.from-bird").allTextContents()).some(t => t.includes("三体")), "离线管家查找笔记");

  await page.evaluate(async () => {
    const { useApp } = await import("/src/app/store.ts");
    const { useWorld } = await import("/src/app/worldStore.ts");
    const batch = Array.from({ length: 1000 }, (_, i) => {
      const path = `读书/压力笔记${String(i).padStart(4, "0")}.md`;
      window.__MOCK_FILES__[path] = `# 笔记${i}`;
      return { path, name: path.split("/").pop(), kind: "markdown", size: 12, mtime: Date.now() };
    });
    useApp.getState().addBatch(batch);
    const shelf = useWorld.getState().layout.furniture.find(f => f.shelf?.folder === "读书");
    useWorld.getState().openGui({ kind: "shelf", fid: shelf.id });
  });
  await page.locator(".slot-grid").waitFor();
  check(await page.locator(".slot-grid > .slot").count() === 27, "千篇笔记书架每页仅渲染27格");
  await page.keyboard.press("Meta+k");
  await page.getByPlaceholder("搜索文件名或正文…").fill("压力笔记0999");
  await page.getByRole("button", { name: "压力笔记0999.md 读书", exact: true }).waitFor();
  check(true, "千篇笔记中文文件名搜索");
  await page.evaluate((results) => { window.__REVIEW_RESULTS__ = results; }, results);
}
