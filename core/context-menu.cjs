'use strict';
// Native edit roles operate on the focused Chromium field, not arbitrary IPC text.
function editorMenuTemplate(params) {
 const f=params.editFlags||{},selected=!!params.selectionText;
 if(!params.isEditable)return selected?[{label:'复制',role:'copy',enabled:!!f.canCopy}]:[];
 return [{label:'撤销',role:'undo',enabled:!!f.canUndo},{label:'重做',role:'redo',enabled:!!f.canRedo},{type:'separator'},
 {label:'剪切',role:'cut',enabled:!!f.canCut},{label:'复制',role:'copy',enabled:!!f.canCopy},
 {label:'粘贴',role:'paste',enabled:!!f.canPaste},{label:'删除选中文字',role:'delete',enabled:!!f.canDelete},
 {type:'separator'},{label:'全选',role:'selectAll',enabled:!!f.canSelectAll}];
}
function installEditorContextMenu(win,Menu){
 win.webContents.on('context-menu',(_event,params)=>{
  if(win.isDestroyed())return;
  const template=editorMenuTemplate(params);if(template.length)Menu.buildFromTemplate(template).popup({window:win});
 });
}
module.exports={editorMenuTemplate,installEditorContextMenu};
