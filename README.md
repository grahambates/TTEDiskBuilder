# TTE Disk Builder

Cross-platform C# console app (.NET 9) which builds a bootable floppy disk image based on a json file

**Platforms:** Windows, macOS, Linux

Pass the app the folder where the disk is to be built from.

The folder must contain a ```disk.json``` and a ```bootblock``` binary file.

The app will write a ```final.adf``` in the folder.

## Requirements

The following packer executables need to be available either in your system PATH or in the build folder:

* **Shrinkler** - https://github.com/askeksa/Shrinkler
* **Salvador** (ZX0) - https://github.com/emmanuel-marty/salvador
* **Zopfli** (Deflate) - https://github.com/google/zopfli

**Note:** Ensure you download and install the appropriate version for your platform (Windows, macOS, or Linux).

Example json

```
[
  {
    "Filename": "tinytro.bin",
    "FileID": "BOOT",
    "PackingMethod": 2,
    "Cacheable": false,
  },
  {
    "Filename": "LOAD",
    "FileID": "0000",
    "PackingMethod": 2,
    "Cacheable": false,
  }
]
```

|Field|Description|
|:---|:---|
|Filename|Physical file name in folder|
|FileID|Four byte alpha-numeric file identifier|
|Packing Method|See below|
|Cacheable|Sets file to be cacheable by TTE loader|

Packing Method

        0 = None
        1 = Shrinkler
        2 = ZX0
        3 = LZ
        4 = Deflate
        5 = Trim

# Resulting ADF file

The resulting ADF file will contain a table of contents from location $400. All files are then applied straight after the table of contents.

## Table of contents

Each entry is 16 bytes long.

|Field|Description|
|:---|:---|
|FileID|LONG - ASCII FileID|
|Disk Position|LONG - The starting position in bytes on the disk|
|Packed File Size|LONG - bits 31-28 = Packing Type / bits 27-24 = Cache flag / bits 23-0 = Data length|
|Unpacked File Size|LONG - Size of file after unpacking|



