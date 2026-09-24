---
description: Replik Projesi Tasarım Kuralları (Solid Bento & Maximalist Blok Dili)
---

# Replik Tasarım Kuralları (Design Rules)

1. **Glow Effect Yasaktır (No Glow Effects):**
   - Hiçbir bileşende, kartta, butonda, sekmede veya arka planda `box-shadow` parlama efektleri (`0 0 20px rgba(...)`), neon ışıma, ambiyans ışığı (`radial-gradient` ışık lekeleri) veya metin parlaması (`text-shadow`) **kesinlikle kullanılmaz**.

2. **Glassmorphism Yasaktır (No Glassmorphism):**
   - Buzlu cam (`backdrop-filter: blur(...)`), yarı saydam cam kartlar, çift katmanlı şeffaf çerçeveler (`rgba(255,255,255,0.05)`) kullanılmaz.
   - Tüm kartlar, paneller ve modallar **tamamen mat ve düz (solid)** yüzeylere (`#121212`, `#1a1a17`, `#1c1c1c`) ve net kenarlıklara (`2px solid #2a2a2a` veya `1.5px solid #333333`) sahip olmalıdır.

3. **Sitenin Maximalist Solid Bento Tasarım Dili:**
   - Renkler mat, doygun ve blok halinde kullanılır:
     - Sarı: `#F5E636` (Metin: `#090909`)
     - Mercan / Coral: `#FF6B4A` (Metin: `#090909` veya `#1a0f0a`)
     - Adaçayı / Sage: `#B8E6C1` (Metin: `#0d1a10`)
     - Lila / Lilac: `#D4C2FC` (Metin: `#140d21`)
   - Tipografi yüksek kontrastlı, kalın (`font-weight: 800` - `900`) ve sıkı harf aralıklıdır (`letter-spacing: -0.04em`).

4. **Gereksiz İkon ve Kapsül Yazılar Kullanılmaz:**
   - Kart başlıklarında gereksiz kapsül etiketler (`eyebrow pill`), input alanlarının içinde dekoratif ikon kutuları veya buton içlerinde süs ikonları kullanılmaz. Sade, net ve güçlü tipografik bloklar tercih edilir.
