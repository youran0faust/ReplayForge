const sceneRenderer = window.sceneRenderer = createSceneRenderer(document.querySelector('#stage'));
let project, resourceUrls;
async function initialize(p, urls) {
  project = p;
  resourceUrls = urls || {};
  sceneRenderer.render({background: {}, characters: [], dialogues: []}, project, resourceUrls);
  await sceneRenderer.preload(project, resourceUrls);
  const titles = project.scene?.performance?.titles || [];
  if (titles.length) {
    if (!globalThis.TitleLayout) throw new Error('标题布局校验模块不可用，不能导出');
    const probe = TitleLayout.createTitleLayoutProbe(document);
    try {
      for (const title of titles) {
        const result = await probe.measure(title, project.design);
        if (!result.fits) throw new Error(`标题溢出：${title.id}，请缩短文字或调整字号后重试。`);
      }
    } finally { probe.dispose(); }
  }
  await sceneRenderer.ready();
}
async function renderFrame(state) {
  if (!project) throw new Error('Export renderer must be initialized first');
  sceneRenderer.render(state, project, resourceUrls);
  await sceneRenderer.ready();
}
