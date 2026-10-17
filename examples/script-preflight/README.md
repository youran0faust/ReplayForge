# A批剧本预检示例

从工作区根目录运行：

```powershell
node P2/examples/script-preflight/create-demo-assets.cjs
node P2/script-preflight.cjs --script P2/examples/script-preflight/demo.txt --assets P2/examples/script-preflight/素材 --config P2/examples/script-preflight/config.json
```

生成的是三个0.1秒合成音WAV，用来验证名称匹配，不是对白录音。已有不同内容文件拒绝覆盖。

`--out 新报告.json` 可将结果写到不存在的文件；父目录须存在，已有文件拒绝覆盖。退出0表示本批语法／引用／名称匹配通过，2表示预检有错误，1表示读取或参数失败。`ok:true`不代表能生成工程：报告始终明确 `canGenerate:false`、`mediaValidated:false`。

本批为开发CLI，尚未接入编辑器GUI，不要求最终用户长期编辑JSON。配置只是A批最小字段集，不是最终角色素材包：角色底图、分层画布等仍需后续映射设计。TXT和MD同语法；站位完整名为标准，布局上下文兼容。

## 少量人工校正

首次报告包含对白nodeId、素材id和sourceHash。需校正时，另建JSON，通过 `--corrections 文件.json` 读取：

```json
{"version":1,"sourceHash":"复制当前报告的哈希","overrides":{"line-6":{"status":"unvoiced"},"line-7":{"resourceId":"复制目录索引中的资源id"}}}
```

资源索引可从 `scanAssets` API取得；报告中的assetCatalog也包含条目。临时line-N身份仅适用于同一原文哈希；更改文本后旧校正拒绝复用，不能把此入口当作完整文本回接。sourceHash为去BOM后的UTF-8文本哈希，行尾改变也视为新文本。

无配音确认不消耗数字序列。缺文件不自动降为无配音。自动匹配按角色从001起，摘要去空格标点后必须全文一致；短摘要会进入人工核对，不模糊猜测。字母后缀新增不进入初始数字队列。

## 限制

- 目录扫描只认类别及扩展名，不探测图像／音频／视频内容，不验证角色图片可用。
- 标题、视频、遮罩可解析但未生成演出；本批所有脚本均不生成工程。
- 校正JSON不是最终用户界面；GUI异常列表、持久身份、自动编排、真实媒体预检和回导仍待后续。
- 未实现精确并行动作时间／占位规划；离场表情提示仅按源顺序粗查，不代替后续时间规划器。
