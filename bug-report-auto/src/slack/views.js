import { CALLBACKS } from "./constants.js";
import { plainText } from "./helpers.js";

function buildProductOptions(products = []) {
  const fallback = ["ЛИС", "Склад", "Касса"];
  const values = products.length > 0 ? products : fallback;

  return values.map((product) => ({
    text: plainText(product),
    value: product,
  }));
}

function normalizeJiraProjectKey(value) {
  return String(value || "").trim().toUpperCase();
}

function buildProjectOption(project, fallbackKey = "") {
  const key = normalizeJiraProjectKey(project?.key || fallbackKey);
  const name = String(project?.name || "").trim();
  const label = name ? `${name} (${key})` : key;

  return {
    text: plainText(label.slice(0, 75)),
    value: key,
  };
}

function buildJiraProjectOptions(projects = [], selectedProjectKey = "") {
  const selectedKey = normalizeJiraProjectKey(selectedProjectKey);
  const optionsByKey = new Map();
  const selectedProject = projects.find(
    (project) => normalizeJiraProjectKey(project.key) === selectedKey
  );

  if (selectedKey && projects.length > 0) {
    optionsByKey.set(selectedKey, buildProjectOption(selectedProject, selectedKey));
  }

  for (const project of projects) {
    const key = normalizeJiraProjectKey(project.key);
    if (!key || optionsByKey.has(key)) {
      continue;
    }

    optionsByKey.set(key, buildProjectOption(project));
    if (optionsByKey.size >= 100) {
      break;
    }
  }

  return Array.from(optionsByKey.values());
}

export function buildBugReportModal(products = []) {
  return {
    type: "modal",
    callback_id: CALLBACKS.BUG_CREATE_MODAL,
    title: plainText("Новый баг"),
    submit: plainText("Отправить"),
    close: plainText("Отмена"),
    blocks: [
      {
        type: "input",
        block_id: "clinic_id_block",
        label: plainText("Айди клиники"),
        element: {
          type: "plain_text_input",
          action_id: "clinic_id_input",
          placeholder: plainText("Например: 4"),
        },
      },
      {
        type: "input",
        block_id: "product_block",
        label: plainText("Продукт"),
        element: {
          type: "static_select",
          action_id: "product_select",
          placeholder: plainText("Выберите продукт"),
          options: buildProductOptions(products),
        },
      },
      {
        type: "input",
        block_id: "user_role_block",
        label: plainText("Роль пользователя"),
        element: {
          type: "plain_text_input",
          action_id: "user_role_input",
          placeholder: plainText("Например: Врач, Кассир, Админ"),
        },
      },
      {
        type: "input",
        block_id: "priority_block",
        label: plainText("Приоритетность"),
        element: {
          type: "static_select",
          action_id: "priority_select",
          placeholder: plainText("Выберите приоритет"),
          options: [
            { text: plainText("Очень высокий"), value: "very_high" },
            { text: plainText("Высокий"), value: "high" },
            { text: plainText("Средний"), value: "medium" },
            { text: plainText("Низкий"), value: "low" },
          ],
        },
      },
      {
        type: "input",
        block_id: "section_block",
        label: plainText("Раздел"),
        element: {
          type: "plain_text_input",
          action_id: "section_input",
          placeholder: plainText("Например: Пациенты - Беременные"),
        },
      },
      {
        type: "input",
        block_id: "reproduction_steps_block",
        label: plainText("Шаги воспроизведения"),
        element: {
          type: "plain_text_input",
          action_id: "reproduction_steps_input",
          multiline: true,
          placeholder: plainText(
            "Например: Открыл карточку пациента, нажал Сохранить, после чего появилась ошибка"
          ),
        },
      },
      {
        type: "input",
        block_id: "expected_result_block",
        label: plainText("Ожидаемый результат"),
        element: {
          type: "plain_text_input",
          action_id: "expected_result_input",
          multiline: true,
          placeholder: plainText("Например: Изменения должны были сохраниться без ошибки"),
        },
      },
      {
        type: "input",
        block_id: "actual_result_block",
        label: plainText("Фактический результат"),
        element: {
          type: "plain_text_input",
          action_id: "actual_result_input",
          multiline: true,
          placeholder: plainText("Например: Появляется сообщение об ошибке, и данные не сохраняются"),
        },
      },
      {
        type: "input",
        block_id: "description_block",
        label: plainText("Описание"),
        element: {
          type: "plain_text_input",
          action_id: "description_input",
          multiline: true,
          placeholder: plainText("Дополнительный контекст, детали и комментарии"),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "*Фото и файлы*\nПосле отправки формы бот создаст карточку бага. Скриншоты и файлы можно будет прикрепить сообщением в тред к этой карточке.",
        },
      },
      {
        type: "input",
        block_id: "attachment_note_block",
        optional: true,
        label: plainText("Комментарий к вложению"),
        element: {
          type: "plain_text_input",
          action_id: "attachment_note_input",
          multiline: true,
          placeholder: plainText("Что приложите: скрин, видео, лог, документ"),
        },
      },
    ],
  };
}

export function buildRejectModal(bugId) {
  return {
    type: "modal",
    callback_id: CALLBACKS.REJECT_MODAL,
    private_metadata: JSON.stringify({ bugId }),
    title: plainText("Отклонить баг"),
    submit: plainText("Отклонить"),
    close: plainText("Отмена"),
    blocks: [
      {
        type: "input",
        block_id: "reason_block",
        label: plainText("Причина отклонения"),
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
          placeholder: plainText("Укажите причину для заявителя"),
        },
      },
    ],
  };
}

export function buildDuplicateModal(bugId) {
  return {
    type: "modal",
    callback_id: CALLBACKS.DUPLICATE_MODAL,
    private_metadata: JSON.stringify({ bugId }),
    title: plainText("Отметить дубликат"),
    submit: plainText("Сохранить"),
    close: plainText("Отмена"),
    blocks: [
      {
        type: "input",
        block_id: "master_bug_block",
        label: plainText("ID основного бага"),
        element: {
          type: "plain_text_input",
          action_id: "master_bug_input",
          placeholder: plainText("Например: BUG-0001"),
        },
      },
    ],
  };
}

export function buildLinkJiraModal(bugId, options = {}) {
  const selectedProjectKey = normalizeJiraProjectKey(options.projectKey);
  const mappedProjectKey = normalizeJiraProjectKey(options.mappedProjectKey);
  const projectOptions = buildJiraProjectOptions(options.jiraProjects || [], selectedProjectKey);
  const selectedProjectOption = projectOptions.find((option) => option.value === selectedProjectKey);
  const projectKeyElement =
    projectOptions.length > 0
      ? {
          type: "static_select",
          action_id: "jira_project_key_select",
          placeholder: plainText("Выберите Jira проект"),
          options: projectOptions,
          ...(selectedProjectOption ? { initial_option: selectedProjectOption } : {}),
        }
      : {
          type: "plain_text_input",
          action_id: "jira_project_key_input",
          placeholder: plainText("Например: LIS, CORE, CASH, ADM"),
          ...(selectedProjectKey ? { initial_value: selectedProjectKey } : {}),
        };

  return {
    type: "modal",
    callback_id: CALLBACKS.LINK_JIRA_MODAL,
    private_metadata: JSON.stringify({ bugId, defaultProjectKey: selectedProjectKey }),
    title: plainText("Создать в Jira"),
    submit: plainText("Создать"),
    close: plainText("Отмена"),
    blocks: [
      {
        type: "input",
        block_id: "jira_project_key_block",
        optional: true,
        label: plainText("Ключ проекта Jira"),
        hint: plainText(
          mappedProjectKey
            ? `По маппингу продукта выбран ${mappedProjectKey}. Можно выбрать другой проект.`
            : "Выберите проект из Jira или укажите ключ вручную."
        ),
        element: projectKeyElement,
      },
      {
        type: "input",
        block_id: "jira_summary_block",
        optional: true,
        label: plainText("Заголовок Jira"),
        element: {
          type: "plain_text_input",
          action_id: "jira_summary_input",
          placeholder: plainText("Если оставить пустым, бот соберет заголовок сам"),
        },
      },
      {
        type: "input",
        block_id: "jira_note_block",
        optional: true,
        label: plainText("Дополнительный комментарий"),
        element: {
          type: "plain_text_input",
          action_id: "jira_note_input",
          multiline: true,
          placeholder: plainText("Например: проверить на prod или связать с обращением клиента"),
        },
      },
    ],
  };
}
