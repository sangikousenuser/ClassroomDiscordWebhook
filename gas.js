// =========================================================================
// ★ 設定項目 ★
// =========================================================================
// Discord Webhook URL (通知を送信したいDiscordチャンネルのWebhook URL)
// アプリアイコン等も自動で設定されますので変更不要
const WEBHOOK_URL = 'https://discord.com/api/webhooks/xxxxxx'

// 除外したいGoogle ClassroomのコースIDのリスト
const EXCLUDED_COURSE_IDS = [
  'xxxxxxxxxx' //カンマで複数可能
];
// =========================================================================

// スクリプトプロパティサービスを取得
const SCRIPT_PROP = PropertiesService.getScriptProperties();

/**
 * Google APIの日付オブジェクトを読みやすい文字列にフォーマットするヘルパー関数
 * @param {object} dateObject Google APIのDateオブジェクト (例: {year: 2023, month: 12, day: 25})
 * @param {object} timeObject Google APIのTimeOfDayオブジェクト (例: {hours: 9, minutes: 30})
 * @return {string} フォーマットされた日時文字列 (例: "2023/12/25 09:30")、または日付のみ
 */
function formatDueDate(dateObject, timeObject) {
  if (!dateObject) return '期限なし';
  let dateStr = `${dateObject.year}/${String(dateObject.month).padStart(2, '0')}/${String(dateObject.day).padStart(2, '0')}`;
  if (timeObject && timeObject.hours !== undefined) { // timeObject.hoursが0の場合も考慮
    dateStr += ` ${String(timeObject.hours).padStart(2, '0')}:${String(timeObject.minutes || 0).padStart(2, '0')}`;
  }
  return dateStr;
}

/**
 * 指定されたコースIDの新しいお知らせと課題をチェックし、Discordに通知する関数
 * @param {string} courseId チェックするGoogle ClassroomのコースID
 * @param {string} courseName チェックするGoogle Classroomのコース名
 */
function checkSpecificCourseAndNotify(courseId, courseName) {
  const itemsToSendToDiscord = []; // お知らせと課題をまとめて格納する配列

  // --- 1. お知らせの処理 ---
  try {
    const lastProcessedAnnouncementDatePropKey = 'LAST_PROCESSED_ANNOUNCEMENT_DATE_' + courseId;
    const lastProcessedAnnouncementDate = SCRIPT_PROP.getProperty(lastProcessedAnnouncementDatePropKey);
    let newLastProcessedAnnouncementDate = lastProcessedAnnouncementDate ? new Date(lastProcessedAnnouncementDate) : null;

    const announcementsResponse = Classroom.Courses.Announcements.list(courseId, {
      orderBy: 'updateTime desc',
      pageSize: 10
    });
    const announcements = announcementsResponse.announcements;

    if (announcements && announcements.length > 0) {
      for (let i = announcements.length - 1; i >= 0; i--) {
        const announcement = announcements[i];
        const announcementUpdateTime = new Date(announcement.updateTime);

        if (!lastProcessedAnnouncementDate || announcementUpdateTime.getTime() > new Date(lastProcessedAnnouncementDate).getTime()) {
          let authorName = '不明な投稿者';
          if (announcement.creatorUserId) {
            try {
              const profile = Classroom.UserProfiles.get(announcement.creatorUserId);
              if (profile && profile.name && profile.name.fullName) authorName = profile.name.fullName;
            } catch (e) { console.warn(`投稿者情報取得失敗(お知らせ) -コース「${courseName}」: ${e.message}`); }
          }

          const embed = {
            author: { name: `📢 ${courseName} からの新しいお知らせ`, icon_url: "https://ssl.gstatic.com/classroom/ic_product_classroom_144.png" },
            title: `投稿者: ${authorName}`,
            description: (announcement.text || "（本文なし）").substring(0, 4000),
            url: announcement.alternateLink,
            timestamp: announcement.updateTime,
            color: 0x20975A, // 緑っぽい色
            fields: []
          };

          if (announcement.materials && announcement.materials.length > 0) {
            let materialFieldValue = '';
            announcement.materials.forEach(material => {
              let linkTitle = '不明なファイル'; let linkUrl = '#';
              if (material.driveFile && material.driveFile.driveFile) { linkTitle = material.driveFile.driveFile.title; linkUrl = material.driveFile.driveFile.alternateLink; }
              else if (material.link) { linkTitle = material.link.title || 'リンク'; linkUrl = material.link.url; }
              else if (material.youtubeVideo) { linkTitle = `YouTube: ${material.youtubeVideo.title}`; linkUrl = material.youtubeVideo.alternateLink; }
              materialFieldValue += `[${linkTitle}](${linkUrl})\n`;
            });
            if (materialFieldValue) embed.fields.push({ name: "添付ファイル", value: materialFieldValue.substring(0, 1020), inline: false });
          }
          
          itemsToSendToDiscord.push({
            type: 'announcement',
            updateTime: announcementUpdateTime,
            payload: {
              username: "Classroom通知",
              avatar_url: "https://ssl.gstatic.com/classroom/ic_product_classroom_144.png",
              embeds: [embed]
            }
          });

          if (!newLastProcessedAnnouncementDate || announcementUpdateTime.getTime() > newLastProcessedAnnouncementDate.getTime()) {
            newLastProcessedAnnouncementDate = announcementUpdateTime;
          }
        }
      }
    }
    if (newLastProcessedAnnouncementDate) {
      SCRIPT_PROP.setProperty(lastProcessedAnnouncementDatePropKey, newLastProcessedAnnouncementDate.toISOString());
      // console.log(`コース「${courseName}」のお知らせ最終処理日時を更新: ${newLastProcessedAnnouncementDate.toISOString()}`); // 詳細ログは必要に応じて
    }
  } catch (error) {
    console.error(`コース「${courseName}」(ID: ${courseId}) のお知らせ処理中にエラー: ` + error.toString());
  }

  // --- 2. 課題の処理 ---
  try {
    const lastProcessedCourseWorkDatePropKey = 'LAST_PROCESSED_COURSEWORK_DATE_' + courseId;
    const lastProcessedCourseWorkDate = SCRIPT_PROP.getProperty(lastProcessedCourseWorkDatePropKey);
    let newLastProcessedCourseWorkDate = lastProcessedCourseWorkDate ? new Date(lastProcessedCourseWorkDate) : null;

    const courseWorkResponse = Classroom.Courses.CourseWork.list(courseId, {
      orderBy: 'updateTime desc',
      pageSize: 10
    });
    const courseWorks = courseWorkResponse.courseWork;

    if (courseWorks && courseWorks.length > 0) {
      for (let i = courseWorks.length - 1; i >= 0; i--) {
        const work = courseWorks[i];
        const workUpdateTime = new Date(work.updateTime);

        if (!lastProcessedCourseWorkDate || workUpdateTime.getTime() > new Date(lastProcessedCourseWorkDate).getTime()) {
          const embed = {
            author: { name: `✏️ ${courseName} に新しい課題`, icon_url: "https://ssl.gstatic.com/classroom/ic_product_classroom_144.png" },
            title: (work.title || "名称未設定の課題").substring(0, 250),
            description: (work.description || "（説明なし）").substring(0, 4000),
            url: work.alternateLink,
            timestamp: work.updateTime,
            color: 0xFFA500, // オレンジっぽい色 (課題用)
            fields: []
          };

          const dueDateStr = formatDueDate(work.dueDate, work.dueTime);
          embed.fields.push({ name: "提出期限", value: dueDateStr, inline: true });
          if (work.workType) {
            embed.fields.push({ name: "種類", value: work.workType.replace(/_/g, ' ').toLowerCase(), inline: true });
          }
          if (work.maxPoints !== undefined) {
            embed.fields.push({ name: "配点", value: `${work.maxPoints}点`, inline: true });
          }

          if (work.materials && work.materials.length > 0) {
            let materialFieldValue = '';
            work.materials.forEach(material => {
              let linkTitle = '不明なファイル'; let linkUrl = '#';
              if (material.driveFile && material.driveFile.driveFile) { linkTitle = material.driveFile.driveFile.title; linkUrl = material.driveFile.driveFile.alternateLink; }
              else if (material.link) { linkTitle = material.link.title || 'リンク'; linkUrl = material.link.url; }
              else if (material.youtubeVideo) { linkTitle = `YouTube: ${material.youtubeVideo.title}`; linkUrl = material.youtubeVideo.alternateLink; }
              materialFieldValue += `[${linkTitle}](${linkUrl})\n`;
            });
            if (materialFieldValue) embed.fields.push({ name: "関連資料", value: materialFieldValue.substring(0, 1020), inline: false });
          }

          itemsToSendToDiscord.push({
            type: 'courseWork',
            updateTime: workUpdateTime,
            payload: {
              username: "Classroom課題通知",
              avatar_url: "https://ssl.gstatic.com/classroom/ic_product_classroom_144.png",
              embeds: [embed]
            }
          });

          if (!newLastProcessedCourseWorkDate || workUpdateTime.getTime() > newLastProcessedCourseWorkDate.getTime()) {
            newLastProcessedCourseWorkDate = workUpdateTime;
          }
        }
      }
    }
    if (newLastProcessedCourseWorkDate) {
      SCRIPT_PROP.setProperty(lastProcessedCourseWorkDatePropKey, newLastProcessedCourseWorkDate.toISOString());
      // console.log(`コース「${courseName}」の課題最終処理日時を更新: ${newLastProcessedCourseWorkDate.toISOString()}`); // 詳細ログは必要に応じて
    }
  } catch (error) {
    console.error(`コース「${courseName}」(ID: ${courseId}) の課題処理中にエラー: ` + error.toString());
  }

  // --- 3. 新しい項目があればDiscordに送信 (更新日時の昇順で) ---
  if (itemsToSendToDiscord.length > 0) {
    itemsToSendToDiscord.sort((a, b) => a.updateTime.getTime() - b.updateTime.getTime());

    itemsToSendToDiscord.forEach(item => {
      const options = {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify(item.payload)
      };
      try {
        UrlFetchApp.fetch(WEBHOOK_URL, options);
        console.log(`コース「${courseName}」の${item.type === 'announcement' ? 'お知らせ' : '課題'}をDiscordに送信しました。`);
      } catch (e) {
        console.error(`Discordへの送信に失敗 (コース: ${courseName}, タイプ: ${item.type}): ${e.message}`);
      }
       Utilities.sleep(500);
    });
  }
}

/**
 * スクリプト実行アカウントが参加している全てのコースをチェックし、新しいお知らせと課題を通知する関数
 * この関数をトリガーに設定します。
 */
function checkAllMyCoursesAndNotify() {
  console.log("全コースのお知らせ・課題チェックを開始します...");
  let courses = [];
  let pageToken;

  try {
    pageToken = undefined;
    do {
      const response = Classroom.Courses.list({ teacherId: 'me', pageSize: 100, pageToken: pageToken });
      if (response.courses) courses = courses.concat(response.courses);
      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (e) { console.error("教師コース取得失敗: " + e.message); }
  
  const teacherCourseIds = new Set(courses.map(c => c.id));
  let studentCourses = [];
  try {
    pageToken = undefined;
    do {
      const response = Classroom.Courses.list({ studentId: 'me', pageSize: 100, pageToken: pageToken });
      if (response.courses) {
        response.courses.forEach(course => {
          if (!teacherCourseIds.has(course.id)) {
            studentCourses.push(course);
          }
        });
      }
      pageToken = response.nextPageToken;
    } while (pageToken);
  } catch (e) { console.error("生徒コース取得失敗: " + e.message); }

  courses = courses.concat(studentCourses);
  
  const uniqueCourses = courses.filter((course, index, self) =>
    index === self.findIndex((c) => (c.id === course.id))
  );
  
  console.log(`${uniqueCourses.length}件のユニークなコースを検出しました。`);

  if (uniqueCourses && uniqueCourses.length > 0) {
    uniqueCourses.forEach(course => {
      // ★★★ 除外処理を追加 ★★★
      if (EXCLUDED_COURSE_IDS.includes(course.id)) {
        console.log(`除外対象コースのためスキップ: ${course.name} (ID: ${course.id})`);
        return; // このコースのforEachイテレーションをスキップ (次のコースへ)
      }
      // ★★★ 除外処理ここまで ★★★

      if (course.courseState === "ACTIVE") {
         console.log(`チェック中: ${course.name} (ID: ${course.id})`);
         checkSpecificCourseAndNotify(course.id, course.name);
      } else {
         console.log(`スキップ (非アクティブ): ${course.name} (ID: ${course.id}, 状態: ${course.courseState})`);
      }
      Utilities.sleep(1000); 
    });
    console.log('全コースのチェックが完了しました。');
  } else {
    console.log('監視対象のコースが見つかりませんでした。');
  }
}
// =========================================================================
// ★★★ 過去の通知履歴をリセットする関数 ★★★
// =========================================================================
function resetNotificationHistory() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const keysToDelete = [];

  // 全てのプロパティキーを取得
  const allKeys = scriptProperties.getKeys();

  // 通知履歴に関連するキーを特定
  // キーのパターン: LAST_PROCESSED_ANNOUNCEMENT_DATE_コースID
  // キーのパターン: LAST_PROCESSED_COURSEWORK_DATE_コースID
  allKeys.forEach(function(key) {
    if (key.startsWith('LAST_PROCESSED_ANNOUNCEMENT_DATE_') || key.startsWith('LAST_PROCESSED_COURSEWORK_DATE_')) {
      keysToDelete.push(key);
    }
  });

  if (keysToDelete.length > 0) {
    console.log(`以下の通知履歴プロパティを削除します (${keysToDelete.length}件):`);
    keysToDelete.forEach(function(key) {
      scriptProperties.deleteProperty(key);
      console.log(` - 削除しました: ${key}`);
    });
    console.log('通知履歴のリセットが完了しました。次回の通常実行時に、全ての投稿が再通知の対象となります。');
    // スクリプトエディタ内で実行した場合にダイアログを表示
    if (typeof Browser !== 'undefined' && Browser.msgBox) {
      Browser.msgBox('通知履歴のリセット完了', `削除されたプロパティキーは ${keysToDelete.length} 件です。詳細はログを確認してください。`, Browser.Buttons.OK);
    }
  } else {
    console.log('削除対象の通知履歴プロパティは見つかりませんでした。');
    if (typeof Browser !== 'undefined' && Browser.msgBox) {
      Browser.msgBox('通知履歴リセット', '削除対象の通知履歴プロパティは見つかりませんでした。', Browser.Buttons.OK);
    }
  }
}
