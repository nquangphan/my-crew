import { describe, expect, it } from 'vitest';
import { BMAD_PERSONAL_KEYS, type BmadAnswer, checkBmadAnswers } from '../src/bmad/answers.js';

const a = (key: string, value: string, module = 'bmm'): BmadAnswer => ({ module, key, value });

describe('checkBmadAnswers', () => {
  it('khóa cá nhân giữ đúng danh sách của v2', () => {
    expect(BMAD_PERSONAL_KEYS).toEqual(['user_name', 'user_skill_level', 'communication_language']);
  });

  it('câu trả lời cấp nhóm hợp lệ, kể cả giá trị có {project-root}', () => {
    expect(
      checkBmadAnswers([
        a('planning_artifacts', '{project-root}/_bmad-output/planning-artifacts'),
        a('project_name', 'repo-a'),
        a('enable_tests', 'true'),
      ]),
    ).toEqual([]);
    expect(checkBmadAnswers([])).toEqual([]);
  });

  it('từ chối user_name, user_skill_level', () => {
    expect(checkBmadAnswers([a('user_name', 'Quang'), a('user_skill_level', 'expert')])).toEqual([
      'bmm.user_name: câu trả lời cá nhân không dùng cho dự án',
      'bmm.user_skill_level: câu trả lời cá nhân không dùng cho dự án',
    ]);
  });

  it('ngôn ngữ chỉ nhận khi allowLanguage và giá trị là tên ngôn ngữ', () => {
    expect(checkBmadAnswers([a('communication_language', 'Vietnamese')])).toEqual([
      'bmm.communication_language: câu trả lời cá nhân không dùng cho dự án',
    ]);
    const opts = { allowLanguage: true };
    expect(
      checkBmadAnswers(
        [a('communication_language', 'Vietnamese'), a('document_output_language', 'Tiếng Việt')],
        opts,
      ),
    ).toEqual([]);
    expect(checkBmadAnswers([a('document_output_language', 'vi_VN')], opts)).toEqual([
      'bmm.document_output_language: không phải tên ngôn ngữ',
    ]);
    expect(checkBmadAnswers([a('communication_language', '')], opts)).toEqual([
      'bmm.communication_language: không phải tên ngôn ngữ',
    ]);
  });

  it.each([
    'github_token',
    'client_secret',
    'db_password',
    'passwd',
    'aws_credential',
    'api_key',
    'apikey',
    'private_path',
  ])('khóa giống credential %s bị từ chối', (key) => {
    expect(checkBmadAnswers([a(key, 'x')])).toEqual([`bmm.${key}: khóa giống credential`]);
  });

  it('khóa và module sai định dạng', () => {
    expect(checkBmadAnswers([a('Bad-Key', 'x')])).toEqual(['bmm.Bad-Key: khóa không phải snake_case']);
    expect(checkBmadAnswers([a('k', 'x', 'BMM')])).toEqual(['BMM.k: tên module không hợp lệ']);
  });

  it.each([
    ['/etc/passwd', 'đường dẫn tuyệt đối'],
    ['~/x', 'đường dẫn tuyệt đối'],
    ['{project-root}/../x', 'đường dẫn ra ngoài repo (..)'],
    ['..', 'đường dẫn ra ngoài repo (..)'],
    ['a\\..\\b', 'đường dẫn ra ngoài repo (..)'],
    ['dòng 1\ndòng 2', 'có ký tự điều khiển'],
    ['a\u007fb', 'có ký tự điều khiển'],
    ['x'.repeat(501), 'dài hơn 500 ký tự'],
  ])('giá trị %j → %s', (value, why) => {
    expect(checkBmadAnswers([a('output_folder', value)])).toEqual([`bmm.output_folder: ${why}`]);
  });

  it('giá trị có .. trong tên (không phải đoạn đường dẫn) vẫn hợp lệ, đúng 500 ký tự hợp lệ', () => {
    expect(checkBmadAnswers([a('title', 'v1..v2'), a('long', 'x'.repeat(500))])).toEqual([]);
  });
});
