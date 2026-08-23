import svgPaths from "./svg-kk8bqmscs6";

function Heading() {
  return (
    <div className="h-[28px] relative shrink-0 w-[93.406px]" data-name="Heading 3">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <p className="absolute font-['Inter:Semi_Bold',sans-serif] font-semibold leading-[28px] left-0 not-italic text-[#1a2b3c] text-[18px] top-[-1px]">Assign Task</p>
      </div>
    </div>
  );
}

function Icon() {
  return (
    <div className="h-[20px] overflow-clip relative shrink-0 w-full" data-name="Icon">
      <div className="absolute inset-1/4" data-name="Vector">
        <div className="absolute inset-[-8.33%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 11.6667 11.6667">
            <path d={svgPaths.p354ab980} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.66667" />
          </svg>
        </div>
      </div>
      <div className="absolute inset-1/4" data-name="Vector">
        <div className="absolute inset-[-8.33%]">
          <svg className="block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 11.6667 11.6667">
            <path d={svgPaths.p2a4db200} id="Vector" stroke="var(--stroke-0, #6B7280)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.66667" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Button() {
  return (
    <div className="relative rounded-[12px] shrink-0 size-[32px]" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start pt-[6px] px-[6px] relative size-full">
        <Icon />
      </div>
    </div>
  );
}

function Container1() {
  return (
    <div className="h-[65px] relative shrink-0 w-[448px]" data-name="Container">
      <div aria-hidden="true" className="absolute border-[#e5e7eb] border-b border-solid inset-0 pointer-events-none" />
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-center justify-between pb-px px-[24px] relative size-full">
        <Heading />
        <Button />
      </div>
    </div>
  );
}

function Label() {
  return (
    <div className="absolute content-stretch flex h-[20px] items-start left-0 top-0 w-[400px]" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">
        <span className="leading-[20px]">{`Driver Name `}</span>
        <span className="leading-[20px] text-[#fb2c36]">*</span>
      </p>
    </div>
  );
}

function Option() {
  return <div className="absolute left-[-575.5px] size-0 top-[-198.5px]" data-name="Option" />;
}

function Dropdown() {
  return (
    <div className="absolute bg-white border border-[#e5e7eb] border-solid h-[49px] left-0 rounded-[16px] top-[26px] w-[400px]" data-name="Dropdown">
      <Option />
    </div>
  );
}

function Paragraph() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start left-0 top-[79px] w-[400px]" data-name="Paragraph">
      <p className="flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[16px] min-h-px min-w-px not-italic relative text-[#e17100] text-[12px] whitespace-pre-wrap">All drivers are currently assigned.</p>
    </div>
  );
}

function Container3() {
  return (
    <div className="h-[95px] relative shrink-0 w-full" data-name="Container">
      <Label />
      <Dropdown />
      <Paragraph />
    </div>
  );
}

function Label1() {
  return (
    <div className="absolute content-stretch flex h-[20px] items-start left-0 top-0 w-[400px]" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">
        <span className="leading-[20px]">{`Truck `}</span>
        <span className="leading-[20px] text-[#fb2c36]">*</span>
      </p>
    </div>
  );
}

function Option1() {
  return <div className="absolute left-[-575.5px] size-0 top-[-309.5px]" data-name="Option" />;
}

function Dropdown1() {
  return (
    <div className="absolute bg-white border border-[#e5e7eb] border-solid h-[49px] left-0 rounded-[16px] top-[26px] w-[400px]" data-name="Dropdown">
      <Option1 />
    </div>
  );
}

function Paragraph1() {
  return (
    <div className="absolute content-stretch flex h-[16px] items-start left-0 top-[79px] w-[400px]" data-name="Paragraph">
      <p className="flex-[1_0_0] font-['Inter:Regular',sans-serif] font-normal leading-[16px] min-h-px min-w-px not-italic relative text-[#e17100] text-[12px] whitespace-pre-wrap">No trucks available. Add a truck first.</p>
    </div>
  );
}

function Container4() {
  return (
    <div className="h-[95px] relative shrink-0 w-full" data-name="Container">
      <Label1 />
      <Dropdown1 />
      <Paragraph1 />
    </div>
  );
}

function Label2() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">
        <span className="leading-[20px]">{`Destination `}</span>
        <span className="leading-[20px] text-[#fb2c36]">*</span>
      </p>
    </div>
  );
}

function TextInput() {
  return (
    <div className="bg-white h-[50px] relative rounded-[16px] shrink-0 w-full" data-name="Text Input">
      <div className="flex flex-row items-center overflow-clip rounded-[inherit] size-full">
        <div className="content-stretch flex items-center px-[16px] py-[12px] relative size-full">
          <p className="font-['Inter:Regular',sans-serif] font-normal leading-[normal] not-italic relative shrink-0 text-[#6b7280] text-[16px]">e.g. Makati City, Metro Manila</p>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
    </div>
  );
}

function Container5() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] h-[76px] items-start relative shrink-0 w-full" data-name="Container">
      <Label2 />
      <TextInput />
    </div>
  );
}

function Label3() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">
        <span className="leading-[20px]">{`Company `}</span>
        <span className="leading-[20px] text-[#fb2c36]">*</span>
      </p>
    </div>
  );
}

function TextInput1() {
  return (
    <div className="bg-white h-[50px] relative rounded-[16px] shrink-0 w-full" data-name="Text Input">
      <div className="flex flex-row items-center overflow-clip rounded-[inherit] size-full">
        <div className="content-stretch flex items-center px-[16px] py-[12px] relative size-full">
          <p className="font-['Inter:Regular',sans-serif] font-normal leading-[normal] not-italic relative shrink-0 text-[#6b7280] text-[16px]">e.g. ABC Retail Corp</p>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
    </div>
  );
}

function Container6() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] h-[76px] items-start relative shrink-0 w-full" data-name="Container">
      <Label3 />
      <TextInput1 />
    </div>
  );
}

function Label4() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">
        <span className="leading-[20px]">{`Delivery Date `}</span>
        <span className="leading-[20px] text-[#fb2c36]">*</span>
      </p>
    </div>
  );
}

function DatePicker() {
  return (
    <div className="bg-white h-[50px] relative rounded-[16px] shrink-0 w-full" data-name="Date Picker">
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
    </div>
  );
}

function Container7() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] h-[76px] items-start relative shrink-0 w-full" data-name="Container">
      <Label4 />
      <DatePicker />
    </div>
  );
}

function Label5() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[0] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[0px] whitespace-pre-wrap">
        <span className="leading-[20px] text-[14px]">{`Remarks `}</span>
        <span className="leading-[16px] text-[#6b7280] text-[12px]">(optional)</span>
      </p>
    </div>
  );
}

function TextArea() {
  return (
    <div className="bg-white h-[74px] relative rounded-[16px] shrink-0 w-full" data-name="Text Area">
      <div className="overflow-clip rounded-[inherit] size-full">
        <div className="content-stretch flex items-start px-[16px] py-[12px] relative size-full">
          <p className="font-['Inter:Regular',sans-serif] font-normal leading-[24px] not-italic relative shrink-0 text-[#6b7280] text-[16px]">Any special instructions…</p>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
    </div>
  );
}

function Container8() {
  return (
    <div className="content-stretch flex flex-col gap-[6px] h-[106px] items-start relative shrink-0 w-full" data-name="Container">
      <Label5 />
      <TextArea />
    </div>
  );
}

function Button1() {
  return (
    <div className="flex-[1_0_0] h-[42px] min-h-px min-w-px relative rounded-[16px]" data-name="Button">
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex items-start px-[17px] py-[11px] relative size-full">
        <p className="flex-[1_0_0] font-['Inter:Medium',sans-serif] font-medium leading-[20px] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] text-center whitespace-pre-wrap">Cancel</p>
      </div>
    </div>
  );
}

function Icon1() {
  return (
    <div className="absolute left-[63.63px] size-[16px] top-[13px]" data-name="Icon">
      <svg className="absolute block size-full" fill="none" preserveAspectRatio="none" viewBox="0 0 16 16">
        <g clipPath="url(#clip0_51_110)" id="Icon">
          <path d={svgPaths.p39ee6532} id="Vector" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
          <path d={svgPaths.p17134c00} id="Vector_2" stroke="var(--stroke-0, white)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
        </g>
        <defs>
          <clipPath id="clip0_51_110">
            <rect fill="white" height="16" width="16" />
          </clipPath>
        </defs>
      </svg>
    </div>
  );
}

function Button2() {
  return (
    <div className="bg-[#10b981] flex-[1_0_0] h-[42px] min-h-px min-w-px relative rounded-[16px]" data-name="Button">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid relative size-full">
        <Icon1 />
        <p className="-translate-x-1/2 absolute font-['Inter:Medium',sans-serif] font-medium leading-[20px] left-[109.13px] not-italic text-[14px] text-center text-white top-[10px]">{` Assign`}</p>
      </div>
    </div>
  );
}

function Container9() {
  return (
    <div className="content-stretch flex gap-[12px] h-[46px] items-start pt-[4px] relative shrink-0 w-full" data-name="Container">
      <Button1 />
      <Button2 />
    </div>
  );
}

function E() {
  return (
    <div className="content-stretch flex flex-col gap-[16px] h-[666px] items-start relative shrink-0 w-full" data-name="E3">
      <Container3 />
      <Container4 />
      <Container5 />
      <Container6 />
      <Container7 />
      <Container8 />
      <Container9 />
    </div>
  );
}

function Container2() {
  return (
    <div className="flex-[1_0_0] min-h-px min-w-px relative w-[448px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col items-start overflow-clip pt-[24px] px-[24px] relative rounded-[inherit] size-full">
        <E />
      </div>
    </div>
  );
}

export default function Container() {
  return (
    <div className="bg-white content-stretch flex flex-col items-start relative rounded-[16px] shadow-[0px_25px_50px_0px_rgba(0,0,0,0.25)] size-full" data-name="Container">
      <Container1 />
      <Container2 />
    </div>
  );
}