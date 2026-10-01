export function createSelectionImage(home,{scheme,rows}){
 const sheet=document.createElement('canvas');sheet.width=1536;sheet.height=1940;
 const ctx=sheet.getContext('2d');ctx.fillStyle='#f5f3ee';ctx.fillRect(0,0,1536,1940);
 const text=(value,x,y,size=24,color='#263341',weight=400)=>{ctx.fillStyle=color;ctx.font=`${weight} ${size}px "Segoe UI", Arial, sans-serif`;ctx.fillText(value,x,y);};
 const wrap=(value,x,y,width,size=23,line=34)=>{ctx.font=`${size}px "Segoe UI", Arial, sans-serif`;let words=value.split(' '),row='';for(const word of words){const next=row?row+' '+word:word;if(ctx.measureText(next).width>width&&row){text(row,x,y,size);y+=line;row=word;}else row=next;}if(row){text(row,x,y,size);y+=line;}return y;};
 ctx.fillStyle='#fff';ctx.fillRect(0,0,1536,150);ctx.fillStyle='#f3c63f';ctx.fillRect(0,146,1536,4);
 text('KB Home',48,61,34,'#263341',700);text('Your Home. Your Style',48,107,23);
 ctx.textAlign='right';text('EXTERIOR COLOR STUDIO',1488,59,22,'#6d737b',600);text(scheme,1488,106,30,'#263341',600);ctx.textAlign='left';
 ctx.drawImage(home,0,150,1536,1024);
 text('Your exterior selections',48,1238,32,'#263341',600);
 rows.forEach((row,i)=>{const col=i%2,line=Math.floor(i/2),x=48+col*744,y=1270+line*103;
 ctx.fillStyle=row.color;ctx.fillRect(x,y,64,64);ctx.strokeStyle='#0003';ctx.strokeRect(x+.5,y+.5,63,63);
 text(row.label,x+84,y+22,22,'#6d737b',600);text(row.paint,x+84,y+53,25,'#263341',500);
 });
 ctx.fillStyle='#e1e4e7';ctx.fillRect(48,1690,1440,2);
 text('PLEASE NOTE',48,1730,20,'#263341',700);
 wrap('This rendering is for illustration only and may not represent your selected floor plan or elevation. Details, materials and landscaping may differ. Colors shown on screen or in print may vary from actual paint colors and their appearance in person due to lighting, materials and display settings. Review physical samples and confirm final selections and availability with your KB Home team.',48,1767,1440,22,29);
 return sheet;
}
