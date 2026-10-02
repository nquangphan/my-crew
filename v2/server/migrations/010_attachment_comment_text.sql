-- Forward-only attachment-comment producer prerequisite; legacy service validation stays strict.
alter table comments drop constraint comments_text_check;
alter table comments add constraint comments_text_check check(length(text) between 0 and 32768);
