# 터미널 깜빡임 없는 재그리기 패턴

## 원리

터미널에서 화면을 업데이트할 때 깜빡임이 발생하는 두 가지 원인:

1. **커서 점프** — 재그리기 중 커서가 화면을 뛰어다니는 게 보임
2. **중간 프레임** — 여러 번 `write()`를 호출하면 호출 사이에 터미널이 부분적으로 렌더링함

## 패턴

```typescript
let out = "\x1b[?25l";              // 1. 커서 숨김
if (lineCount > 0) {
  out += `\x1b[${lineCount}A\x1b[0J`; // 2. 위로 올리고 아래 지우기 (in-place)
}
out += lines.join("\n") + "\n";     // 3. 새 내용
out += "\x1b[?25h";                 // 4. 커서 복원
process.stdout.write(out);          // 5. 단 한 번의 write
lineCount = lines.length;           // 6. 줄 수 추적
```

## ANSI 코드 설명

| 코드 | 의미 |
|------|------|
| `\x1b[?25l` | 커서 숨김 |
| `\x1b[?25h` | 커서 표시 |
| `\x1b[nA` | 커서 n줄 위로 |
| `\x1b[0J` | 커서 위치부터 화면 끝까지 지우기 |
| `\x1b[2J\x1b[H` | 전체 화면 지우기 (화면 전환 시에만 사용) |

## 구현 예시

```typescript
let lineCount = 0;

const draw = (first: boolean) => {
  const lines = buildLines(); // 출력할 줄 배열 구성

  let out = "\x1b[?25l";
  if (first) {
    out += "\x1b[2J\x1b[H"; // 첫 진입 시 전체 화면 클리어
    lineCount = 0;
  } else if (lineCount > 0) {
    out += `\x1b[${lineCount}A\x1b[0J`; // 이전 내용 덮어쓰기
  }
  out += lines.join("\n") + "\n";
  out += "\x1b[?25h";
  process.stdout.write(out);
  lineCount = lines.length;
};

draw(true);  // 첫 진입

// 이후 업데이트
draw(false); // 깜빡임 없이 in-place 재그리기
```

## 주의사항

- `lineCount` 추적이 어긋나면 이전 내용이 남거나 과도하게 지워짐
- 추적 외부에서 `console.log` / `process.stdout.write`로 줄을 추가한 경우 (예: 구매 메시지) 다음 `draw(true)`로 초기화
- 전체 화면 클리어(`\x1b[2J\x1b[H`)는 **화면 전환 시에만** — 매 키입력마다 호출하면 깜빡임 원인이 됨

## 적용된 파일

- `packages/cli/src/commands/shop.ts` — 카테고리 선택, 캐러셀
- `packages/cli/src/commands/heal.ts` — 치료 애니메이션 (동일 원리, `first` 플래그 없이 `redraw` boolean 사용)
