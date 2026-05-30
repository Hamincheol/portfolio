exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, {
      error: "Method Not Allowed",
      message: "POST 요청만 사용할 수 있습니다."
    });
  }

  let body;

  try {
    body = JSON.parse(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, {
      error: "Invalid JSON",
      message: "요청 데이터 형식이 올바르지 않습니다."
    });
  }

  const knownIssueUrl = String(body.url || "").trim();

  if (!knownIssueUrl || !/^https?:\/\//i.test(knownIssueUrl)) {
    return jsonResponse(400, {
      error: "Invalid URL",
      message: "공식 노운이슈 공지사항 URL을 올바르게 입력해주세요."
    });
  }

  try {
    const pageText = await fetchKnownIssuePageText(knownIssueUrl);

    if (!pageText || pageText.length < 50) {
      return jsonResponse(400, {
        error: "Page text is too short",
        message: "공지사항 본문을 충분히 읽지 못했습니다."
      });
    }

    const issueItems = extractKnownIssueItems(pageText);
    const generated = generateTcFromKnownIssues({
      knownIssueUrl,
      issueItems
    });

    return jsonResponse(200, generated);
  } catch (error) {
    console.error(error);

    return jsonResponse(500, {
      error: "Known issue parsing failed",
      message: error.message || "노운이슈 TC 자동 생성 중 오류가 발생했습니다."
    });
  }
};

async function fetchKnownIssuePageText(url) {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 Portfolio Known Issue TC Generator",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7"
    }
  });

  if (!response.ok) {
    throw new Error(`공지사항 페이지를 읽지 못했습니다. HTTP ${response.status}`);
  }

  const html = await response.text();
  return htmlToReadableText(html).slice(0, 40000);
}

function htmlToReadableText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h1|h2|h3|h4|br|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractKnownIssueItems(text) {
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)
    .filter((line) => !isNoiseLine(line));

  const issueLikeLines = lines.filter((line) => isKnownIssueLikeLine(line));

  const sourceLines = issueLikeLines.length ? issueLikeLines : lines;

  const merged = mergeIssueLines(sourceLines);

  return merged
    .map((item) => item.trim())
    .filter((item) => item.length >= 8)
    .slice(0, 20);
}

function normalizeLine(line) {
  return String(line || "")
    .replace(/^[\-*•ㆍ·\d.)\]\[]+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseLine(line) {
  const lower = line.toLowerCase();

  if (line.length < 4) return true;

  const noisePatterns = [
    "로그인",
    "회원가입",
    "공유",
    "목록",
    "댓글",
    "조회",
    "작성자",
    "공지사항",
    "뒤로가기",
    "이전글",
    "다음글",
    "copyright",
    "all rights reserved",
    "privacy",
    "terms",
    "고객센터"
  ];

  return noisePatterns.some((pattern) => lower.includes(pattern.toLowerCase()));
}

function isKnownIssueLikeLine(line) {
  const patterns = [
    /known issue/i,
    /known issues/i,
    /노운\s*이슈/i,
    /알려진\s*문제/i,
    /확인된\s*문제/i,
    /현재\s*확인/i,
    /문제/i,
    /현상/i,
    /오류/i,
    /버그/i,
    /수정/i,
    /발생/i,
    /비정상/i,
    /정상적으로.*않/i,
    /노출되지/i,
    /진행되지/i,
    /적용되지/i,
    /표시되지/i,
    /동작하지/i,
    /튕김/i,
    /크래시/i,
    /멈춤/i,
    /프리징/i,
    /블랙스크린/i
  ];

  return patterns.some((pattern) => pattern.test(line));
}

function mergeIssueLines(lines) {
  const result = [];

  for (const line of lines) {
    const last = result[result.length - 1];

    if (
      last &&
      last.length < 50 &&
      !/[.!?。]$/.test(last) &&
      !/현상$|문제$|오류$|않음$|않는 현상$/.test(last)
    ) {
      result[result.length - 1] = `${last} ${line}`;
    } else {
      result.push(line);
    }
  }

  return dedupe(result);
}

function dedupe(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = item.replace(/\s+/g, "").toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

function generateTcFromKnownIssues({ knownIssueUrl, issueItems }) {
  const cases = [];
  const steps = [];

  const safeItems = issueItems.length
    ? issueItems
    : ["공식 노운이슈 공지사항에 기재된 항목이 정상적으로 재현 및 검증 가능한지 확인"];

  safeItems.slice(0, 12).forEach((issueText, index) => {
    const testKey = `AUTO-KI-${String(index + 1).padStart(3, "0")}`;
    const category = classifyIssue(issueText);
    const priority = decidePriority(issueText, category);
    const component = decideComponent(issueText, category);
    const automationStatus = decideAutomationStatus(category);

    cases.push({
      Project_Key: "AUTO",
      Folder_L1: "Known Issue",
      Folder_L2: category.folder,
      Component: component,
      Test_Key_Local: testKey,
      Name: makeCaseName(issueText, category),
      Objective_or_Description: makeObjective(issueText, category),
      Precondition: makePrecondition(category),
      Priority: priority,
      Owner: "",
      Labels_Tags: makeLabels(category),
      Requirement_ID: knownIssueUrl,
      Automation_Status: automationStatus,
      Version_or_FixVersion: "",
      Comment: "공식 Known Issue URL 기반 규칙 생성 TC 초안"
    });

    const generatedSteps = makeSteps({
      testKey,
      issueText,
      category
    });

    steps.push(...generatedSteps);
  });

  return {
    sourceUrl: knownIssueUrl,
    generationType: "rule-based",
    template: {
      casesSheet: "inZOI_Cases",
      stepsSheet: "inZOI_Steps"
    },
    cases,
    steps
  };
}

function classifyIssue(text) {
  const value = String(text || "");

  if (/크래시|튕김|종료|멈춤|프리징|블랙스크린|진행 불가|접속 불가|실행 불가/i.test(value)) {
    return {
      type: "blocker",
      folder: "Crash / Progression",
      label: "진행 차단"
    };
  }

  if (/보상|아이템|재화|포인트|경험치|수량|지급|획득|중복|누락/i.test(value)) {
    return {
      type: "reward",
      folder: "Reward / Item",
      label: "보상/아이템"
    };
  }

  if (/UI|화면|버튼|팝업|창|메뉴|노출|표시|아이콘|이미지|썸네일/i.test(value)) {
    return {
      type: "ui",
      folder: "UI / Display",
      label: "UI/표시"
    };
  }

  if (/텍스트|문구|오탈자|툴팁|번역|설명|메시지/i.test(value)) {
    return {
      type: "text",
      folder: "Text / Tooltip",
      label: "텍스트"
    };
  }

  if (/퀘스트|미션|진행|완료|조건|달성|카운트|업적/i.test(value)) {
    return {
      type: "quest",
      folder: "Quest / Mission",
      label: "퀘스트/미션"
    };
  }

  if (/캐릭터|커스터마이징|외형|의상|헤어|얼굴|스킨|장착|착용/i.test(value)) {
    return {
      type: "character",
      folder: "Character / Customization",
      label: "캐릭터/외형"
    };
  }

  return {
    type: "function",
    folder: "Function / Regression",
    label: "기능/회귀"
  };
}

function decidePriority(text, category) {
  const value = String(text || "");

  if (
    category.type === "blocker" ||
    /크래시|튕김|종료|멈춤|프리징|블랙스크린|진행 불가|접속 불가|실행 불가/i.test(value)
  ) {
    return "High";
  }

  if (category.type === "text") {
    return "Low";
  }

  return "Medium";
}

function decideComponent(text, category) {
  const value = String(text || "");

  if (/캐릭터|커스터마이징|외형|의상|헤어|얼굴|스킨/i.test(value)) return "Character";
  if (/보상|아이템|재화|포인트|경험치/i.test(value)) return "Reward";
  if (/퀘스트|미션|업적|조건/i.test(value)) return "Quest";
  if (/UI|화면|버튼|팝업|메뉴|노출|표시/i.test(value)) return "UI";
  if (/텍스트|문구|툴팁|번역/i.test(value)) return "Text";
  if (/접속|로그인|서버|네트워크/i.test(value)) return "System";
  if (/크래시|튕김|멈춤|프리징|블랙스크린/i.test(value)) return "Stability";

  return category.label || "Function";
}

function decideAutomationStatus(category) {
  if (category.type === "ui" || category.type === "text") return "Semi";
  if (category.type === "reward" || category.type === "quest") return "Candidate";
  return "Manual";
}

function makeLabels(category) {
  const base = ["known-issue", "auto-generated", "regression"];

  if (category.type) {
    base.push(category.type);
  }

  return base.join(", ");
}

function makeCaseName(issueText, category) {
  const clean = shorten(issueText, 54);

  if (category.type === "blocker") {
    return `[Known Issue] ${clean} 재현 및 진행 차단 여부 확인`;
  }

  if (category.type === "reward") {
    return `[Known Issue] ${clean} 보상/수량 정합성 확인`;
  }

  if (category.type === "ui") {
    return `[Known Issue] ${clean} 화면 노출 확인`;
  }

  if (category.type === "text") {
    return `[Known Issue] ${clean} 문구 표시 확인`;
  }

  return `[Known Issue] ${clean} 수정 반영 확인`;
}

function makeObjective(issueText, category) {
  if (category.type === "blocker") {
    return `공식 노운이슈 항목인 "${issueText}" 현상이 재현되는지 확인하고, 진행 차단 또는 안정성 문제가 발생하는지 검증한다.`;
  }

  if (category.type === "reward") {
    return `공식 노운이슈 항목인 "${issueText}"와 관련하여 보상, 아이템, 수량 정보가 정상 처리되는지 검증한다.`;
  }

  if (category.type === "ui") {
    return `공식 노운이슈 항목인 "${issueText}"와 관련하여 화면 요소가 정상 노출되고 조작 가능한지 검증한다.`;
  }

  if (category.type === "text") {
    return `공식 노운이슈 항목인 "${issueText}"와 관련하여 문구, 툴팁, 팝업 메시지가 정상 표시되는지 검증한다.`;
  }

  return `공식 노운이슈 항목인 "${issueText}"의 재현 여부와 수정 반영 여부를 검증한다.`;
}

function makePrecondition(category) {
  if (category.type === "reward") {
    return "노운이슈 공지사항에 기재된 조건을 만족할 수 있는 계정과 테스트 빌드에 접속 가능한 상태";
  }

  if (category.type === "blocker") {
    return "노운이슈 공지사항에 기재된 발생 조건을 재현할 수 있는 테스트 빌드에 접속 가능한 상태";
  }

  return "공식 노운이슈 공지사항 확인 후, 해당 기능에 접근 가능한 테스트 빌드에 접속한 상태";
}

function makeSteps({ testKey, issueText, category }) {
  const commonStep1 = {
    Test_Key_Local: testKey,
    Step_No: 1,
    Test_Step: "공식 노운이슈 공지사항에서 대상 항목과 발생 조건을 확인한다.",
    Test_Data: issueText,
    Expected_Result: "검증 대상 항목과 발생 조건을 식별할 수 있다.",
    Actual_Result: ""
  };

  if (category.type === "blocker") {
    return [
      commonStep1,
      {
        Test_Key_Local: testKey,
        Step_No: 2,
        Test_Step: "테스트 빌드에 접속한 뒤 노운이슈에 기재된 발생 경로로 이동한다.",
        Test_Data: "",
        Expected_Result: "대상 기능 또는 콘텐츠에 접근할 수 있다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 3,
        Test_Step: "공지사항에 기재된 조건에 맞춰 동일한 동작을 수행한다.",
        Test_Data: issueText,
        Expected_Result: "크래시, 프리징, 블랙스크린, 진행 불가 여부를 확인할 수 있다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 4,
        Test_Step: "동일 조건을 2회 이상 반복하여 재현성을 확인한다.",
        Test_Data: "",
        Expected_Result: "재현 여부와 발생 빈도를 기록할 수 있다.",
        Actual_Result: ""
      }
    ];
  }

  if (category.type === "reward") {
    return [
      commonStep1,
      {
        Test_Key_Local: testKey,
        Step_No: 2,
        Test_Step: "보상 또는 아이템 획득 조건을 만족한다.",
        Test_Data: issueText,
        Expected_Result: "보상 지급 조건을 정상적으로 달성할 수 있다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 3,
        Test_Step: "획득한 보상, 아이템, 재화 수량을 확인한다.",
        Test_Data: "",
        Expected_Result: "보상 종류와 수량이 공지 내용 및 기대값과 일치한다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 4,
        Test_Step: "재접속 또는 화면 이동 후 보상 상태를 다시 확인한다.",
        Test_Data: "",
        Expected_Result: "보상 상태가 유지되며 중복 지급 또는 누락이 발생하지 않는다.",
        Actual_Result: ""
      }
    ];
  }

  if (category.type === "ui") {
    return [
      commonStep1,
      {
        Test_Key_Local: testKey,
        Step_No: 2,
        Test_Step: "대상 화면 또는 메뉴로 이동한다.",
        Test_Data: issueText,
        Expected_Result: "대상 화면에 정상 진입할 수 있다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 3,
        Test_Step: "공지사항에 기재된 UI 요소, 버튼, 팝업, 화면 표시 상태를 확인한다.",
        Test_Data: "",
        Expected_Result: "UI 요소가 누락, 겹침, 비정상 노출 없이 표시된다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 4,
        Test_Step: "관련 버튼 또는 조작 요소를 선택한다.",
        Test_Data: "",
        Expected_Result: "선택한 조작이 오류 없이 정상 동작한다.",
        Actual_Result: ""
      }
    ];
  }

  if (category.type === "text") {
    return [
      commonStep1,
      {
        Test_Key_Local: testKey,
        Step_No: 2,
        Test_Step: "문구, 툴팁, 팝업이 노출되는 화면으로 이동한다.",
        Test_Data: issueText,
        Expected_Result: "대상 문구가 표시되는 화면에 접근할 수 있다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 3,
        Test_Step: "문구, 툴팁, 팝업 메시지의 내용을 확인한다.",
        Test_Data: "",
        Expected_Result: "문구가 잘림, 오탈자, 미번역 없이 정상 표시된다.",
        Actual_Result: ""
      },
      {
        Test_Key_Local: testKey,
        Step_No: 4,
        Test_Step: "해상도 또는 화면 전환 후 동일 문구를 다시 확인한다.",
        Test_Data: "",
        Expected_Result: "화면 전환 후에도 문구 표시 상태가 유지된다.",
        Actual_Result: ""
      }
    ];
  }

  return [
    commonStep1,
    {
      Test_Key_Local: testKey,
      Step_No: 2,
      Test_Step: "테스트 빌드에 접속한 뒤 대상 기능 또는 콘텐츠로 이동한다.",
      Test_Data: issueText,
      Expected_Result: "대상 기능 또는 콘텐츠에 접근할 수 있다.",
      Actual_Result: ""
    },
    {
      Test_Key_Local: testKey,
      Step_No: 3,
      Test_Step: "공지사항에 기재된 조건에 맞춰 기능을 실행한다.",
      Test_Data: "",
      Expected_Result: "기능 실행 중 오류 또는 비정상 동작 여부를 확인할 수 있다.",
      Actual_Result: ""
    },
    {
      Test_Key_Local: testKey,
      Step_No: 4,
      Test_Step: "동일 기능을 재실행하거나 화면을 이동한 뒤 상태를 다시 확인한다.",
      Test_Data: "",
      Expected_Result: "동작 결과가 정상 유지되며 회귀 문제가 발생하지 않는다.",
      Actual_Result: ""
    }
  ];
}

function shorten(text, maxLength) {
  const value = String(text || "").trim();

  if (value.length <= maxLength) return value;

  return `${value.slice(0, maxLength).trim()}...`;
}

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(data)
  };
}