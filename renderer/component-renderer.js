/* Shared production renderer: no editor handles, scripts, or HTML injection. */
(function(root) {
  const FONTS = new Set(['Microsoft YaHei', 'Segoe UI', 'Arial', 'sans-serif', 'serif', 'monospace']);
  function createComponentRenderer(stage, {imageStyle = () => 'none'} = {}) {
    const layer = document.createElement('div');
    layer.className = 'component-layer'; stage.appendChild(layer);
    let revealers = [], textNodes = [], warnings = [], renderRevision = 0;
    function checkOverflow() {
      const overflowing = [];
      warnings.length = 0;
      for (const node of textNodes) {
        const {scrollHeight, clientHeight, scrollWidth, clientWidth} = node;
        // DOM doubles and detached/hidden layouts cannot establish overflow.
        const measured = [scrollHeight, clientHeight, scrollWidth, clientWidth].every(Number.isFinite)
          && (clientHeight > 0 || clientWidth > 0);
        if (measured && (scrollHeight > clientHeight || scrollWidth > clientWidth)) {
          node.dataset.componentOverflow = 'true';
          overflowing.push(node);
          warnings.push({instanceId: node.dataset.componentInstanceId, elementId: node.dataset.elementId, message: 'Text overflows its component bounds; rendering continues without shrinking.'});
        } else delete node.dataset.componentOverflow;
      }
      return overflowing;
    }
    const makeRevealer = typeof module !== 'undefined' && module.exports ? require('./text-revealer.js').createTextRevealer : root.createTextRevealer;
    function render(state, project) {
      for (const r of revealers) r.dispose();
      revealers = []; textNodes = []; warnings = [];
      const revision = ++renderRevision;
      const active = state.performance?.dialogueVisible === false ? null : (state.dialogues || [])[0];
      const definitions = new Map((project.componentDefinitions || []).map(d => [d.id, d]));
      const frame = Number(state.frame), nodes = [];
      let customBodyVisible = false, customSpeakerVisible = false;
      const instances = (project.scene.components || []).filter(i => frame >= (i.visibleFrom ?? 0) && frame < (i.visibleTo ?? project.scene.durationFrames)).slice().sort((a,b) => (a.zIndex || 0) - (b.zIndex || 0));
      for (const instance of instances) {
        const definition = definitions.get(instance.definitionId);
        if (!definition || (definition.visibility === 'when-active-dialogue' && !active)) continue;
        // Performance hide/clear also suppresses instance-range dialogue panels,
        // but never changes legacy projects or ordinary decorations.
        if (state.performance && definition.kind === 'dialogue-ui' && !active) continue;
        const design = definition.designSize;
        if (!design || !(design.width > 0 && design.height > 0 && instance.width > 0 && instance.height > 0)) continue;
        const scale = Math.min(instance.width / design.width, instance.height / design.height);
        const group = document.createElement('div'); group.className = 'component-instance';
        group.dataset.componentId = instance.id; group.dataset.definitionId = definition.id;
        Object.assign(group.style, {left: `${instance.x}px`, top: `${instance.y}px`, width: `${design.width}px`, height: `${design.height}px`, transform: `scale(${scale})`, zIndex: String(instance.zIndex || 0)});
        for (const element of definition.elements || []) {
          if (!['panel','image','text'].includes(element.type)) continue;
          const node = document.createElement('div'), rect = element.rect || {};
          node.className = `component-element component-${element.type}`; node.dataset.elementId = element.id;
          node.dataset.componentInstanceId = instance.id;
          Object.assign(node.style, {left: `${rect.x || 0}px`, top: `${rect.y || 0}px`, width: `${rect.width || 0}px`, height: `${rect.height || 0}px`, opacity: String(element.opacity ?? 1)});
          if (element.type === 'panel') {
            Object.assign(node.style, {backgroundColor: element.fill || 'transparent', opacity: String(element.opacity ?? 1), borderRadius: `${element.radius || 0}px`, borderColor: element.borderColor || 'transparent', borderWidth: `${element.borderWidth || 0}px`, borderStyle: 'solid'});
          } else if (element.type === 'image') {
            node.style.backgroundImage = imageStyle(element.resourceId); node.style.backgroundSize = element.fit === 'fill' ? '100% 100%' : element.fit === 'cover' ? 'cover' : 'contain';
          } else {
            textNodes.push(node);
            let text = element.text || '';
            if (element.binding === 'activeDialogue.text') text = active ? active.text || '' : '';
            if (element.binding === 'activeDialogue.speakerName') {
              const characterDefinitions = root.CharacterDefinitions;
              if (!active) text = '';
              else if (typeof characterDefinitions?.getDialogueSpeakerName === 'function') {
                text = characterDefinitions.getDialogueSpeakerName(project, active.speakerId);
              } else {
                // Keep standalone rendering compatible without binding schema 4
                // dialogue identity to a scene instance or its visibility.
                const character = project.schemaVersion === 4 ? null : (project.scene.characters || []).find(c => c.id === active.speakerId);
                const characterDefinition = (project.characterDefinitions || []).find(d => d.id === (project.schemaVersion === 4 ? active.speakerId : character?.definitionId));
                const resolved = project.schemaVersion === 3 && character && characterDefinitions?.resolveCharacter ? characterDefinitions.resolveCharacter(project, character) : character;
                text = active.speakerId === 'narrator' ? '旁白' : project.schemaVersion === 4 ? (characterDefinition?.name || '') : project.schemaVersion === 3 ? (characterDefinition?.name || resolved?.name || '') : (character?.name || '');
              }
            }
            node.lang = project.locale || 'en-US';
            Object.assign(node.style, {fontFamily: FONTS.has(element.fontFamily) ? element.fontFamily : 'sans-serif', fontSize: `${element.fontSize || 24}px`, color: element.color || '#ffffff', textAlign: ['left','center','right'].includes(element.align) ? element.align : 'left', lineHeight: String(element.lineHeight ?? 1.5)});
            if (element.reveal === 'active-dialogue-progress') {
              const r = makeRevealer(node); r.prepare(String(text), node.lang); r.reveal(active ? active.progress : 0); revealers.push(r);
            } else node.textContent = String(text);
          }
          group.appendChild(node);
        }
        nodes.push(group);
        // Bindings alone never claim the default UI (including decorations).
        if (active && definition.kind === 'dialogue-ui') {
          const roles = definition.roles === undefined ? ['body', 'speaker'] : definition.roles;
          if (Array.isArray(roles)) {
            customBodyVisible ||= roles.includes('body');
            customSpeakerVisible ||= roles.includes('speaker');
          }
        }
      }
      layer.replaceChildren(...nodes);
      checkOverflow(); // Measure full text after attachment; never change its font size.
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => {
          if (revision === renderRevision) checkOverflow();
        });
      }
      return {customDialogueVisible: customBodyVisible && customSpeakerVisible, customBodyVisible, customSpeakerVisible, warnings};
    }
    function dispose() { for (const r of revealers) r.dispose(); revealers = []; textNodes = []; ++renderRevision; layer.remove(); }
    return {render, dispose, layer, checkOverflow};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createComponentRenderer};
  else root.createComponentRenderer = createComponentRenderer;
})(typeof globalThis !== 'undefined' ? globalThis : this);
