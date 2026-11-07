import React, { useState } from 'react';
import { X, Ruler, Sparkles, Check } from 'lucide-react';
import type { TargetGender } from '../../types/index.ts';

interface SizeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialGender?: TargetGender;
}

export const SizeGuideModal: React.FC<SizeGuideModalProps> = ({
  isOpen,
  onClose,
  initialGender = 'men',
}) => {
  const [activeTab, setActiveTab] = useState<'men' | 'women' | 'unisex' | 'pants'>(
    initialGender === 'women' ? 'women' : initialGender === 'unisex' ? 'unisex' : 'men'
  );

  // Bộ tính toán gợi ý size nhanh theo chiều cao & cân nặng
  const [height, setHeight] = useState<number>(170);
  const [weight, setWeight] = useState<number>(62);
  const [calculatedSize, setCalculatedSize] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCalculateSize = (e: React.FormEvent) => {
    e.preventDefault();
    if (activeTab === 'women') {
      if (weight < 46) setCalculatedSize('XS');
      else if (weight <= 51) setCalculatedSize('S');
      else if (weight <= 57) setCalculatedSize('M');
      else if (weight <= 64) setCalculatedSize('L');
      else setCalculatedSize('XL');
    } else if (activeTab === 'unisex') {
      if (weight < 56) setCalculatedSize('S (Rộng vừa)');
      else if (weight <= 68) setCalculatedSize('M (Chuẩn phom)');
      else if (weight <= 78) setCalculatedSize('L (Thoải mái)');
      else setCalculatedSize('XL (Oversized)');
    } else if (activeTab === 'pants') {
      if (weight < 54) setCalculatedSize('Size 29');
      else if (weight <= 60) setCalculatedSize('Size 30');
      else if (weight <= 67) setCalculatedSize('Size 31');
      else if (weight <= 74) setCalculatedSize('Size 32');
      else if (weight <= 80) setCalculatedSize('Size 33');
      else setCalculatedSize('Size 34');
    } else {
      // Nam
      if (weight < 58) setCalculatedSize('S');
      else if (weight <= 66) setCalculatedSize('M');
      else if (weight <= 74) setCalculatedSize('L');
      else if (weight <= 82) setCalculatedSize('XL');
      else setCalculatedSize('XXL');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Box */}
      <div className="relative w-full max-w-2xl bg-[#FAF8F5] rounded-2xl shadow-2xl border border-[#E8E4DA] overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#E8E4DA] bg-white">
          <div className="flex items-center gap-2">
            <Ruler className="w-5 h-5 text-[#2D4A3E]" />
            <h2 className="text-base font-bold text-[#1A1C19]">
              Bảng Quy Đổi & Gợi Ý Size Baity
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#6B665C] hover:text-[#1A1C19] rounded-md transition-colors"
            aria-label="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab chuyển đổi bảng size */}
        <div className="flex border-b border-[#E8E4DA] bg-[#F2EFE9] px-4 pt-2 gap-2 text-xs font-semibold">
          <button
            onClick={() => {
              setActiveTab('men');
              setCalculatedSize(null);
            }}
            className={`py-2 px-4 rounded-t-lg transition-colors ${
              activeTab === 'men'
                ? 'bg-white text-[#2D4A3E] border-t-2 border-[#2D4A3E]'
                : 'text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            Bảng Size Nam
          </button>
          <button
            onClick={() => {
              setActiveTab('women');
              setCalculatedSize(null);
            }}
            className={`py-2 px-4 rounded-t-lg transition-colors ${
              activeTab === 'women'
                ? 'bg-white text-[#2D4A3E] border-t-2 border-[#2D4A3E]'
                : 'text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            Bảng Size Nữ
          </button>
          <button
            onClick={() => {
              setActiveTab('unisex');
              setCalculatedSize(null);
            }}
            className={`py-2 px-4 rounded-t-lg transition-colors ${
              activeTab === 'unisex'
                ? 'bg-white text-[#2D4A3E] border-t-2 border-[#2D4A3E]'
                : 'text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            Bảng Size Unisex
          </button>
          <button
            onClick={() => {
              setActiveTab('pants');
              setCalculatedSize(null);
            }}
            className={`py-2 px-4 rounded-t-lg transition-colors ${
              activeTab === 'pants'
                ? 'bg-white text-[#2D4A3E] border-t-2 border-[#2D4A3E]'
                : 'text-[#6B665C] hover:text-[#1A1C19]'
            }`}
          >
            Size Quần (28 - 34)
          </button>
        </div>

        {/* Nội dung bảng size & form tính toán */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Công cụ tính toán size nhanh */}
          <div className="bg-white p-4 rounded-xl border border-[#E0DCD3] shadow-2xs">
            <div className="flex items-center gap-2 mb-3 text-xs font-bold text-[#2D4A3E] uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-[#C27D56]" />
              <span>Gợi ý size thông minh theo vóc dáng</span>
            </div>
            <form onSubmit={handleCalculateSize} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-[#5C584F] mb-1">
                  Chiều cao (cm)
                </label>
                <input
                  type="number"
                  min="140"
                  max="210"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#5C584F] mb-1">
                  Cân nặng (kg)
                </label>
                <input
                  type="number"
                  min="35"
                  max="130"
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm bg-[#FAF8F5] border border-[#D5D0C5] rounded-lg focus:outline-none focus:border-[#2D4A3E]"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 px-4 bg-[#2D4A3E] text-white text-xs font-semibold rounded-lg hover:bg-[#233B31] transition-colors"
              >
                Tính size phù hợp
              </button>
            </form>

            {calculatedSize && (
              <div className="mt-3 p-3 bg-[#F0ECE1] rounded-lg flex items-center justify-between text-xs text-[#2D4A3E]">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-[#2D4A3E]" />
                  <span>
                    Size đề xuất cho vóc dáng <strong>{height}cm - {weight}kg</strong>:
                  </span>
                </div>
                <span className="font-bold text-sm px-2.5 py-0.5 bg-[#2D4A3E] text-white rounded">
                  {calculatedSize}
                </span>
              </div>
            )}
          </div>

          {/* Chi tiết bảng dữ liệu */}
          <div className="overflow-x-auto">
            {activeTab === 'unisex' ? (
              <div className="space-y-3">
                <div className="p-3 bg-[#EAF0EC] border border-[#D0DFD4] rounded-lg text-xs text-[#2D4A3E] leading-relaxed">
                  <strong>💡 Lưu ý về phom Unisex:</strong> Đồ Unisex tại Baity được thiết kế theo phom rộng suông (Relaxed Fit) hiện đại, vai thả tự nhiên. Bạn nữ thích mặc vừa vặn có thể lùi 1 size so với bảng bên dưới.
                </div>
                <table className="w-full text-xs text-left border-collapse border border-[#E0DCD3]">
                  <thead>
                    <tr className="bg-[#F2EFE9] text-[#1A1C19]">
                      <th className="p-2.5 border border-[#E0DCD3]">Size</th>
                      <th className="p-2.5 border border-[#E0DCD3]">Chiều cao</th>
                      <th className="p-2.5 border border-[#E0DCD3]">Cân nặng</th>
                      <th className="p-2.5 border border-[#E0DCD3]">Đặc điểm phom</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">S</td>
                      <td className="p-2.5 border border-[#E0DCD3]">155 - 165cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">45 - 58kg</td>
                      <td className="p-2.5 border border-[#E0DCD3]">Phom rộng suông, thoải mái</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">M</td>
                      <td className="p-2.5 border border-[#E0DCD3]">165 - 172cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">58 - 68kg</td>
                      <td className="p-2.5 border border-[#E0DCD3]">Rộng vừa vặn chuẩn Streetwear</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">L</td>
                      <td className="p-2.5 border border-[#E0DCD3]">172 - 178cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">68 - 78kg</td>
                      <td className="p-2.5 border border-[#E0DCD3]">Rộng rãi, vai thả thời thượng</td>
                    </tr>
                    <tr>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">XL</td>
                      <td className="p-2.5 border border-[#E0DCD3]">178 - 185cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">78 - 88kg</td>
                      <td className="p-2.5 border border-[#E0DCD3]">Oversized cá tính phóng khoáng</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : activeTab === 'pants' ? (
              <table className="w-full text-xs text-left border-collapse border border-[#E0DCD3]">
                <thead>
                  <tr className="bg-[#F2EFE9] text-[#1A1C19]">
                    <th className="p-2.5 border border-[#E0DCD3]">Size Quần</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Vòng eo (cm)</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Vòng mông (cm)</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Chiều dài quần</th>
                  </tr>
                </thead>
                <tbody>
                  {['28', '29', '30', '31', '32', '33', '34'].map((size, idx) => (
                    <tr key={size} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FAF8F5]'}>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">{size}</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{70 + idx * 3} - {73 + idx * 3}cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{86 + idx * 3} - {89 + idx * 3}cm</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{98 + idx}cm</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-xs text-left border-collapse border border-[#E0DCD3]">
                <thead>
                  <tr className="bg-[#F2EFE9] text-[#1A1C19]">
                    <th className="p-2.5 border border-[#E0DCD3]">Size</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Chiều cao</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Cân nặng</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Vòng ngực</th>
                    <th className="p-2.5 border border-[#E0DCD3]">Vòng eo</th>
                  </tr>
                </thead>
                <tbody>
                  {(activeTab === 'women'
                    ? [
                        { size: 'XS', h: '150 - 155cm', w: '40 - 45kg', c: '78 - 82cm', wa: '60 - 64cm' },
                        { size: 'S', h: '155 - 160cm', w: '45 - 50kg', c: '82 - 86cm', wa: '64 - 68cm' },
                        { size: 'M', h: '160 - 165cm', w: '50 - 56kg', c: '86 - 90cm', wa: '68 - 72cm' },
                        { size: 'L', h: '165 - 170cm', w: '56 - 63kg', c: '90 - 94cm', wa: '72 - 76cm' },
                        { size: 'XL', h: '168 - 175cm', w: '63 - 70kg', c: '94 - 100cm', wa: '76 - 82cm' },
                      ]
                    : [
                        { size: 'S', h: '160 - 165cm', w: '50 - 58kg', c: '86 - 90cm', wa: '72 - 76cm' },
                        { size: 'M', h: '165 - 170cm', w: '59 - 66kg', c: '90 - 94cm', wa: '76 - 80cm' },
                        { size: 'L', h: '170 - 176cm', w: '67 - 74kg', c: '94 - 98cm', wa: '80 - 84cm' },
                        { size: 'XL', h: '176 - 182cm', w: '75 - 82kg', c: '98 - 104cm', wa: '84 - 90cm' },
                        { size: 'XXL', h: '180 - 188cm', w: '83 - 92kg', c: '104 - 110cm', wa: '90 - 98cm' },
                      ]
                  ).map((row, idx) => (
                    <tr key={row.size} className={idx % 2 === 0 ? 'bg-white' : 'bg-[#FAF8F5]'}>
                      <td className="p-2.5 border border-[#E0DCD3] font-bold">{row.size}</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{row.h}</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{row.w}</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{row.c}</td>
                      <td className="p-2.5 border border-[#E0DCD3]">{row.wa}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
