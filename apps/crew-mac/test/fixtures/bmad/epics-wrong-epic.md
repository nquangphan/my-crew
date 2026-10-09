---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: ['_bmad-output/planning-artifacts/prd.md']
---

# repo-a - Epic Breakdown

## Overview

Tài liệu chia yêu cầu từ PRD và Architecture thành epic và story.

## Requirements Inventory

### Functional Requirements

FR1: Trang giới thiệu hiện tên và mô tả ngắn.
FR2: Form liên hệ lưu vào file JSON.

## Epic List

### Epic 1: Trang giới thiệu
Người xem biết chủ trang là ai.

### Epic 2: Form liên hệ
Người xem gửi được lời nhắn.

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Trang giới thiệu

Người xem biết chủ trang là ai.

### Story 1.1: Hiện thông tin

As a người xem,
I want thấy tên và mô tả ngắn,
So that tôi biết chủ trang là ai.

**Acceptance Criteria:**

**Given** trang giới thiệu đã có dữ liệu
**When** người xem mở /gioi-thieu
**Then** trang hiện tên và mô tả ngắn

**Given** chưa có dữ liệu
**When** người xem mở /gioi-thieu
**Then** trang hiện thông báo trống
**And** không lỗi 500

### Story 2.1: Ảnh đại diện

As a người xem,
I want thấy ảnh đại diện,
So that tôi nhận ra chủ trang.

**Acceptance Criteria:**

**Given** có file ảnh đại diện
**When** người xem mở /gioi-thieu
**Then** ảnh hiện cạnh tên

**Given** không có ảnh
**When** người xem mở /gioi-thieu
**Then** hiện ảnh mặc định
**And** thẻ img có alt

## Epic 2: Form liên hệ

Người xem gửi được lời nhắn.

### Story 2.1: Gửi form

As a người xem,
I want gửi tên, email và nội dung,
So that chủ trang nhận được lời nhắn.

**Acceptance Criteria:**

**Given** form đã điền đúng
**When** người xem bấm Gửi
**Then** lời nhắn được lưu vào file JSON
**And** form hiện lời cảm ơn

**Given** email sai định dạng
**When** người xem bấm Gửi
**Then** form báo lỗi email và không lưu
