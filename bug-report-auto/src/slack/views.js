import { CALLBACKS } from "./constants.js";
import { plainText } from "./helpers.js";

export function buildBugReportModal() {
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
          placeholder: plainText("Например: Касса, Склад, ЛИС"),
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
          placeholder: plainText("Опишите проблему подробно"),
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

export function buildLinkJiraModal(bugId) {
  return {
    type: "modal",
    callback_id: CALLBACKS.LINK_JIRA_MODAL,
    private_metadata: JSON.stringify({ bugId }),
    title: plainText("Связать с Jira"),
    submit: plainText("Сохранить"),
    close: plainText("Отмена"),
    blocks: [
      {
        type: "input",
        block_id: "jira_key_block",
        label: plainText("Ключ Jira"),
        element: {
          type: "plain_text_input",
          action_id: "jira_key_input",
          placeholder: plainText("Например: BUGS-123"),
        },
      },
      {
        type: "input",
        block_id: "jira_url_block",
        optional: true,
        label: plainText("Ссылка Jira"),
        element: {
          type: "plain_text_input",
          action_id: "jira_url_input",
          placeholder: plainText("https://your-domain.atlassian.net/browse/BUGS-123"),
        },
      },
    ],
  };
}
