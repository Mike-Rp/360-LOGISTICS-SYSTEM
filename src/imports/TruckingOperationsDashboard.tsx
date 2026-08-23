import imgImage1 from "figma:asset/5e73e3c08e898d68c86717993c6e7442d03e9ac4.png";

function Container3() {
  return (
    <div className="content-stretch flex h-[72px] items-start justify-center relative shrink-0 w-full" data-name="Container">
      <div className="h-[63px] relative shrink-0 w-[112px]" data-name="image 1">
        <img alt="" className="absolute bg-clip-padding border-0 border-[transparent] border-solid inset-0 max-w-none object-cover pointer-events-none size-full" src={imgImage1} />
      </div>
    </div>
  );
}

function Paragraph() {
  return (
    <div className="h-[24px] relative shrink-0 w-full" data-name="Paragraph">
      <p className="-translate-x-1/2 absolute font-['Arial:Regular',sans-serif] leading-[24px] left-[191.61px] not-italic text-[#6b7280] text-[16px] text-center top-[-2px]">{`Trucking Operations & Delivery Tracking`}</p>
    </div>
  );
}

function Container2() {
  return (
    <div className="content-stretch flex flex-col gap-[12px] h-[156px] items-start justify-center relative shrink-0 w-full" data-name="Container">
      <Container3 />
      <Paragraph />
    </div>
  );
}

function Label() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Arial:Regular',sans-serif] leading-[20px] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">License Plate Number</p>
    </div>
  );
}

function TextInput() {
  return (
    <div className="bg-[#f9fafb] h-[50px] relative rounded-[16px] shrink-0 w-full" data-name="Text Input">
      <div className="flex flex-row items-center overflow-clip rounded-[inherit] size-full">
        <div className="content-stretch flex items-center px-[16px] py-[12px] relative size-full">
          <p className="font-['Arial:Regular',sans-serif] leading-[normal] not-italic relative shrink-0 text-[16px] text-[rgba(26,43,60,0.5)] text-center tracking-[0.8px]">e.g., ABC123</p>
        </div>
      </div>
      <div aria-hidden="true" className="absolute border border-[#e5e7eb] border-solid inset-0 pointer-events-none rounded-[16px]" />
    </div>
  );
}

function Container5() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[8px] h-[78px] items-start left-0 top-[16px] w-[384px]" data-name="Container">
      <Label />
      <TextInput />
    </div>
  );
}

function Label1() {
  return (
    <div className="content-stretch flex h-[20px] items-start relative shrink-0 w-full" data-name="Label">
      <p className="flex-[1_0_0] font-['Arial:Regular',sans-serif] leading-[20px] min-h-px min-w-px not-italic relative text-[#1a2b3c] text-[14px] whitespace-pre-wrap">4-Digit PIN</p>
    </div>
  );
}

function InputOtpSlot() {
  return (
    <div className="absolute bg-[#ddd] left-0 rounded-bl-[10px] rounded-tl-[10px] size-[56px] top-0" data-name="InputOTPSlot">
      <div aria-hidden="true" className="absolute border border-[rgba(0,0,0,0)] border-solid inset-0 pointer-events-none rounded-bl-[10px] rounded-tl-[10px]" />
    </div>
  );
}

function InputOtpSlot1() {
  return (
    <div className="absolute bg-[#ddd] left-[60px] size-[56px] top-0" data-name="InputOTPSlot">
      <div aria-hidden="true" className="absolute border-[rgba(0,0,0,0)] border-b border-r border-solid border-t inset-0 pointer-events-none" />
    </div>
  );
}

function InputOtpSlot2() {
  return (
    <div className="absolute bg-[#ddd] left-[120px] size-[56px] top-0" data-name="InputOTPSlot">
      <div aria-hidden="true" className="absolute border-[rgba(0,0,0,0)] border-b border-r border-solid border-t inset-0 pointer-events-none" />
    </div>
  );
}

function InputOtpSlot3() {
  return (
    <div className="absolute bg-[#ddd] left-[180px] rounded-br-[10px] rounded-tr-[10px] size-[56px] top-0" data-name="InputOTPSlot">
      <div aria-hidden="true" className="absolute border-[rgba(0,0,0,0)] border-b border-r border-solid border-t inset-0 pointer-events-none rounded-br-[10px] rounded-tr-[10px]" />
    </div>
  );
}

function InputOtpGroup() {
  return (
    <div className="absolute h-[56px] left-0 top-0 w-[236px]" data-name="InputOTPGroup">
      <InputOtpSlot />
      <InputOtpSlot1 />
      <InputOtpSlot2 />
      <InputOtpSlot3 />
    </div>
  );
}

function TextInput1() {
  return <div className="absolute h-[56px] left-0 top-0 w-[236px]" data-name="Text Input" />;
}

function Input() {
  return (
    <div className="absolute h-[56px] left-[74px] top-0 w-[236px]" data-name="Input">
      <InputOtpGroup />
      <TextInput1 />
    </div>
  );
}

function Container7() {
  return (
    <div className="h-[56px] relative shrink-0 w-full" data-name="Container">
      <Input />
    </div>
  );
}

function Container6() {
  return (
    <div className="absolute content-stretch flex flex-col gap-[8px] h-[84px] items-start left-0 top-[114px] w-[384px]" data-name="Container">
      <Label1 />
      <Container7 />
    </div>
  );
}

function Button() {
  return (
    <div className="absolute bg-[#10b981] content-stretch flex h-[56px] items-center justify-center left-0 py-[16px] rounded-[16px] shadow-[0px_10px_15px_0px_rgba(0,0,0,0.1),0px_4px_6px_0px_rgba(0,0,0,0.1)] top-[218px] w-[384px]" data-name="Button">
      <p className="font-['Arial:Regular',sans-serif] leading-[24px] not-italic relative shrink-0 text-[16px] text-center text-white">Login</p>
    </div>
  );
}

function Button1() {
  return (
    <div className="absolute content-stretch flex h-[20px] items-start left-[154.31px] top-[305px] w-[75.375px]" data-name="Button">
      <p className="decoration-solid font-['Arial:Regular',sans-serif] leading-[20px] not-italic relative shrink-0 text-[#3b82f6] text-[14px] text-center underline">Forgot PIN?</p>
    </div>
  );
}

function Container4() {
  return (
    <div className="h-[326px] relative shrink-0 w-full" data-name="Container">
      <Container5 />
      <Container6 />
      <Button />
      <Button1 />
    </div>
  );
}

function Button2() {
  return (
    <div className="bg-[#2290fa] h-[29px] relative rounded-[16px] shadow-[0px_10px_15px_0px_rgba(0,0,0,0.1),0px_4px_6px_0px_rgba(0,0,0,0.1)] shrink-0 w-[384px]" data-name="Button">
      <div className="flex flex-row items-center justify-center size-full">
        <div className="content-stretch flex items-center justify-center py-[16px] relative size-full">
          <p className="font-['Arial:Regular',sans-serif] leading-[24px] not-italic relative shrink-0 text-[16px] text-center text-white">Admin Login</p>
        </div>
      </div>
    </div>
  );
}

function Summary() {
  return <div className="h-[16px] shrink-0 w-full" data-name="Summary" />;
}

function Paragraph1() {
  return <div className="h-[16px] shrink-0 w-full" data-name="Paragraph" />;
}

function Paragraph2() {
  return <div className="h-[16px] shrink-0 w-full" data-name="Paragraph" />;
}

function Container9() {
  return (
    <div className="h-[36px] relative shrink-0 w-full" data-name="Container">
      <div className="content-stretch flex flex-col gap-[4px] items-start pl-[8px] relative size-full">
        <Paragraph1 />
        <Paragraph2 />
      </div>
    </div>
  );
}

function Details() {
  return (
    <div className="content-stretch flex flex-col gap-[8px] h-[16px] items-start relative shrink-0 w-full" data-name="Details">
      <Button2 />
      <Summary />
      <Container9 />
    </div>
  );
}

function Container8() {
  return (
    <div className="content-stretch flex flex-col h-[46px] items-start pt-[17px] relative shrink-0 w-full" data-name="Container">
      <div aria-hidden="true" className="absolute border-[#e5e7eb] border-solid border-t inset-0 pointer-events-none" />
      <Details />
    </div>
  );
}

function Container1() {
  return (
    <div className="bg-white h-[627px] relative rounded-[16px] shadow-[0px_20px_25px_0px_rgba(0,0,0,0.1),0px_8px_10px_0px_rgba(0,0,0,0.1)] shrink-0 w-full" data-name="Container">
      <div className="content-stretch flex flex-col gap-[24px] items-start pt-[32px] px-[32px] relative size-full">
        <Container2 />
        <Container4 />
        <Container8 />
      </div>
    </div>
  );
}

function Paragraph3() {
  return <div className="h-[20px] shrink-0 w-full" data-name="Paragraph" />;
}

function Container() {
  return (
    <div className="h-[671px] relative shrink-0 w-[448px]" data-name="Container">
      <div className="bg-clip-padding border-0 border-[transparent] border-solid content-stretch flex flex-col gap-[24px] items-start relative size-full">
        <Container1 />
        <Paragraph3 />
      </div>
    </div>
  );
}

export default function TruckingOperationsDashboard() {
  return (
    <div className="content-stretch flex items-center justify-center relative size-full" data-name="Trucking Operations Dashboard" style={{ backgroundImage: "linear-gradient(153.465deg, rgb(240, 253, 244) 0%, rgb(239, 246, 255) 50%, rgb(255, 255, 255) 100%), linear-gradient(90deg, rgb(248, 250, 251) 0%, rgb(248, 250, 251) 100%)" }}>
      <Container />
    </div>
  );
}