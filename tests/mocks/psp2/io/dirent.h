#ifndef TEST_SCE_DIRENT_H
#define TEST_SCE_DIRENT_H

typedef int SceUID;
typedef struct { unsigned int st_mode; long long st_size; } SceIoStat;
typedef struct { char d_name[256]; SceIoStat d_stat; } SceIoDirent;
#define SCE_S_ISDIR(m) (((m) & 0x1000u) != 0)

SceUID sceIoDopen(const char *path);
int sceIoDread(SceUID fd, SceIoDirent *entry);
int sceIoDclose(SceUID fd);

#endif
