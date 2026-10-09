import { cycleTint, furniture, removeFurniture } from "../../app/worldActions";
import { useWorld } from "../../app/worldStore";
import { SPECS } from "../../world/layout";

export function RemoveConfirm({ fid }: { fid: string }) {
  const f = furniture(fid);
  const close = () => useWorld.getState().closeGui();
  if (!f) return null;
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel small-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">拆除{SPECS[f.type].name}？</h2>
        <p className="mc-text small panel-note">
          {f.type === "bookshelf" ? `「${f.shelf?.name}」上的书只是引用，拆除书架不会删除任何文件。` : "拆除家具不会删除任何笔记。"}
        </p>
        <div className="panel-foot">
          {(f.type === "bookshelf" || f.type === "desk") && (
            <button
              className="mc-btn"
              onClick={() => {
                cycleTint(fid);
              }}
            >
              换木色
            </button>
          )}
          <span className="spacer" />
          <button className="mc-btn" onClick={close} autoFocus>
            取消
          </button>
          <button
            className="mc-btn danger"
            onClick={() => {
              removeFurniture(fid);
              close();
            }}
          >
            拆除
          </button>
        </div>
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ["W A S D", "移动"],
  ["鼠标", "转动视角（锁定后）"],
  ["空格", "跳：一格高的桌子、工作台、箱子都能跳上去站着，半格的花坛直接走上去"],
  ["左键门", "开门 / 关门，出去是带花园的院子（围栏以内都能走）"],
  ["G", "叫管家（小鸟）：问它书在哪、让它带路、整理书架、种树除草；再按 Esc 收起聊天，它还跟着你"],
  ["T", "换屋子（7 种，屋顶和墙一起换）"],
  ["P", "宠物：领养、取名、送回家"],
  ["M", "声音与背景音乐"],
  ["左键 / E", "与准星指着的家具或书交互"],
  ["E（对准唱片）", "拿起唱片；拿着时对着留声机按 E 放上去开始放，按住 E 从留声机上取下"],
  ["F / Q（拿着唱片）", "F 拿到眼前细看封面和歌单，Q 放回唱片架"],
  ["院子里 1–8", "园艺工具：树苗、花种、灌木、草垛、花坛、菜地（右键种下），8 是铲子（按住左键挖掉）"],
  ["右键", "把手上的家具放到地上 / 在院子里种下"],
  ["1 – 9、0、-、= / 滚轮", "选择物品栏（1 是空手，= 是楼梯，最后一格唱片架用滚轮或点选）"],
  ["C / ⌘⇧I", "随手记一句灵感，放进鱼塘（Inbox/）"],
  ["拖文件进窗口", "丢在哪件家具上就进哪里：书架、书桌（直接打开）、鱼塘、AI 工作台（附进对话）、资料箱；音乐文件或专辑文件夹丢到唱片架上"],
  ["⌘O", "选择文件导入到资料箱（Imports/）"],
  ["⌥ Enter（搜索里）", "在书房里找到这本书：走过去，书会闪"],
  ["R", "旋转要放置的家具"],
  ["X", "拆除准星指着的家具（不删除文件）"],
  ["Esc", "菜单 / 关闭界面 / 从书桌起身"],
  ["⌘K", "搜索笔记，选中后直接带到书桌"],
  ["⌘J", "书房 ↔ 全屏专注写作"],
  ["⌘S", "立即保存（平时自动保存）"],
];

export function Help() {
  const close = () => useWorld.getState().closeGui();
  return (
    <div className="mc-overlay" onMouseDown={close}>
      <div className="mc-panel help-panel" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="mc-title">操作说明</h2>
        <dl className="help-keys">
          {KEYS.map(([k, v]) => (
            <div key={k}>
              <dt className="mc-text">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mc-text small panel-note">
          书架：收藏书架放文件引用；文件夹书架显示某个文件夹里的文件。书桌：坐下写作。工作台：制作新的 Markdown / Word / TXT。AI 工作台：接入 Claude 等模型问答。资料箱：导入和查看 PDF 等资料。窗户：换窗景、调时间和天气（可以跟随鱼塘）。鱼塘：灵感池，整理随手记下的想法。地毯：空手点一下设置氛围，站上去生效。唱片架：导入的音乐按专辑做成唱片，封面是按名字画的像素画；对准唱片按 E 拿起来（F 细看、Q 放回），走到留声机前按 E 放上去就开始放，按住 E 取下。南墙的门通到院子：小路、花坛、菜地、草垛（可以一级级跳上去）、井；空手点杂草可以拔掉，杂草每天会长一点；走到院子里物品栏换成园艺工具：树苗、花种、灌木、草垛、花坛、菜地右键种下，铲子按住左键挖掉。书多了放楼梯（物品栏 =）加楼层，每层一套书架；书架面板里可以一层层点进子文件夹。暂停菜单里：布局预设、换屋子、挂到墙上（黑板、画框）、宠物、声音、与访达并排。书桌上有沙漏可以计时。
        </p>
        <div className="panel-foot">
          <span className="spacer" />
          <button className="mc-btn" onClick={close} autoFocus>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}
