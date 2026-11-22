/**
 * The disclaimer copy both surfaces show: the plugin's settings page and the
 * standalone/desktop console.
 *
 * The product carries no WorkBuddy and no Huawei Cloud channel. Those two are
 * excluded mechanically (`src/magpie-policy.js`, and the aggregate registry
 * through it), but an exclusion with no explanation leaves a user wondering
 * whether the channel is broken. This copy answers the two questions that
 * matter instead: those channels are not part of what this build offers, and
 * anything a user does with a channel is their own responsibility.
 *
 * The copy is data, not markup: each surface renders it in its own idiom, so
 * there is exactly one place to change what the product says. It is deliberately
 * short — a wall of legal text is read by nobody — and states the project's
 * purpose plainly, because that is the honest description of what it is.
 */

export const DISCLAIMER_VERSION = 4

/** Channels this build does not offer, named for the reader. */
export const EXCLUDED_CHANNELS = Object.freeze([
  '华为云 Huawei Cloud MaaS（huaweicloud，含 Token Plan）',
  'LobsterAI（有道）、Qoder 中国版、Cline、Loomy（讯飞）、Raccoon（商汤）',
])

export const DISCLAIMER = Object.freeze({
  version: DISCLAIMER_VERSION,
  title: '使用须知与免责声明',
  subtitle: '关于本定制版相对原版的差异，以及你需要知道的责任边界',
  intro: '本插件是一个个人学习与技术研究项目，用于学习模型网关、协议适配与本地路由的实现方式，按「现状」提供，不构成任何商业服务或产品承诺。',
  sections: Object.freeze([
    {
      id: 'custom',
      heading: '这是一个自用定制版',
      body: '本定制版在原版「Our Free Model」的基础上，由使用者自行维护并恢复/新增了若干渠道，包括 WorkBuddy 国内版（workbuddy，亦称 CodeBuddy）与 WorkBuddy 国际版（workbuddy-ai），并集成了自建的 Kiro 网关聚合渠道。它独立于原作者发布的版本：原作者的更新与声明不适用于本定制版，本定制版也不会跟随原作者仓库更新。',
    },
    {
      id: 'workbuddy',
      heading: 'WorkBuddy 由独立插件提供',
      body: 'WorkBuddy 国内版（workbuddy，亦称 CodeBuddy）与国际版（workbuddy-ai）不在本插件内实现，而是由独立的 dsh-connect-workbuddy 插件接入：账号登录、账号池、积分与模型目录都由它自己管理，本插件只负责不在策略层封禁它。两者各自独立升级，互不影响；使用 WorkBuddy 的风险与额度由你与该插件的说明约定，本插件不参与、不背书。',
    },
    {
      id: 'trimmed',
      heading: '本定制版只保留五个账号渠道',
      body: '账号渠道仅保留 Qoder、TRAE、MiniMax Code、ZCode 与 Gemini。LobsterAI（有道）、Qoder 中国版、Cline、Loomy（讯飞）、Raccoon（商汤）的代码仍随插件发布，但本定制版不注册它们：其模型不会出现在模型选择器里，也无法登录或添加账号。这样做的目的是让界面聚焦在你实际会用的渠道上，删掉的是入口而非实现。',
    },
    {
      id: 'excluded',
      heading: '本插件不提供的渠道',
      body: '本定制版不包含、也不提供华为云 Huawei Cloud MaaS（huaweicloud，含 Token Plan）。该渠道在插件端与桌面端均被移除：渠道列表、预设、登录入口、插件市场与模型目录里都不会出现，也无法通过导入配置或安装第三方插件启用。',
    },    {
      id: 'responsibility',
      heading: '使用第三方渠道与我们无关',
      body: '你若在本插件之外通过任何方式使用其他第三方服务，包括自行配置地址、导入凭据、安装第三方软件或登录他人账号，均属于你的个人行为。我们不参与、不背书、不提供支持，也不对其可用性、合规性或任何后果承担任何责任。',
    },
    {
      id: 'accounts',
      heading: '账号与凭据由你自己负责',
      body: '本插件只在你本机保存你主动导入的凭据，不会上传到任何服务器。请确保你使用这些账号的方式符合对应服务商的条款与所在地法律；由此产生的封禁、扣费、数据风险或其他损失，由使用者自行承担。',
    },
    {
      id: 'no-warranty',
      heading: '不提供任何担保',
      body: '本项目不对正确性、稳定性、适销性或特定用途适用性作任何明示或默示担保。使用本插件造成的任何直接或间接损失，作者与团队均不承担责任。请自行评估风险，并优先遵守所在地区的法律法规与服务商协议。',
    },
    {
      id: 'lawful',
      heading: '请合法合规使用',
      body: '本项目仅用于个人学习与技术研究。请勿将其用于违反服务商条款、规避授权限制、批量滥用额度或其他违法用途。因使用方式不当引发的争议、索赔或法律责任，均由使用者自行承担。',
    },
  ]),
  accept: '我已阅读并了解',
  reopen: '查看免责声明',
})

/** Whether a stored acknowledgement matches the current copy version. */
export function disclaimerAcknowledged(settings) {
  return Number(settings?.disclaimerAck) === DISCLAIMER_VERSION
}
