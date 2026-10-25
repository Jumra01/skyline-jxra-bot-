# Fitur Primbon

Command primbon dikelompokkan dalam folder ini agar mudah dirawat. Implementasi request dan format respons bersama berada di `lib/primbon.js`.

Command yang tersedia:

- `.artinama <nama>`
- `.kecocokannamapasangan <nama1> | <nama2>`
- `.nomerhoki <nomor>`
- `.potensipenyakit <tgl> <bln> <thn>`
- `.ramalanjodoh <nama1> <tgl1> <bln1> <thn1> <nama2> <tgl2> <bln2> <thn2>`
- `.sifatusahabisnis <tgl> <bln> <thn>`
- `.tafsirmimpi <kata kunci>`
- `.zodiak <nama zodiak>`

Semua plugin command berada langsung di folder ini; loader memindai subfolder secara rekursif.
