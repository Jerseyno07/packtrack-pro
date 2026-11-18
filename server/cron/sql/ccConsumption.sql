select base.*,
base1.FSN
from(
Select
ftft.DeliveryDate,
ftft.FromFacilityId,
F.Name as FacilityName,
ftft.ToFacilityId,
ftftsd.SkuId,
S.Name as Skuname,
c.Name as City,
ftftsd.WeightId,
W.WeightUnit as WeightUnit,
ftftsd.Quantity as TargetQuantity,
ftftsd.AllocatedQuantity
from FacilityToFacilityTransferSkuDetail as ftftsd
left join Sku as S on S.id=ftftsd.SkuId
left join Weight as W on W.id=ftftsd.WeightId
left join FacilityToFacilityTransfer as ftft on ftft.id=ftftsd.FacilityToFacilityTransferId
left join Facility as F on F.id=ftft.FromFacilityId
left join City c on c.id=F.cityid
where date(ftft.deliverydate) + interval 1 day between '{{from date}}' and '{{to date}}'
and ftft.Deleted=0
and ftft.Type in (3)
and F.typeid=2
and F.cityid in (2)
)base

left join(
select DeliveryDate,
CityId,
weightunit,
FSN
from(
select   case when so.subtype=1 and cds.slotname='S8' then so.DeliveryDate+interval 1 day else so.DeliveryDate end as DeliveryDate,
date_format(so.DeliveryDate,"%Y_%u") as YW,
ci.id as CityId,
ci.name as City,
w.conversiontobase,
f.id as FacilityId,
f.name as Facility,
sod.id as SaleOrderDetailsId,
so.id as SaleOrderId,
so.SubType as SOSubType,
so.Type as SOType,
so.Status as SOStatus,
c.id as CustomerId,
c.name as Customer,
bp.id as BusinessPartnerId,
bp.Name as Buisnesspartnername,
s.id as Skuid,
s.Name as Sku,
w.weightunit as weightunit,
s.CategoryId as SkuCategoryId,
pei.fsncode as FSN,
w.BaseWeight as baseweight,
sod.lotweightid as lotweightId,
sod.saleprice as saleprice,
sod.Deleted as Deleted,
sod.SkuQuantity as OrderQuantity,
sod.BilledQuantity as BilledQuantity,
sod.FulfilledQuantity as FulfilledQuantity,
sod.ReturnQuantity as ReturnsQuantity,
case when so.subtype=15 then 0 else sod.SkuQuantity / w.ConversionToBase end as Orderlot,
sod.billedquantity / w.ConversionToBase as billedlot,
sod.fulfilledquantity / w.ConversionToBase as Fulfilledlot,
case when s.categoryid=4 then 'XD'
when (s.name like "%Ugao%" or s.Name like "%Kyari%" or s.Name like "%Phulwa%" or s.Name like "%Farmerr%" or s.Name like "%FlowerAura%" or s.Name like "%Hoovu%") then 'Brands'
else 'FnV' end as Cat,
tag.bucket,
ifnull(xd.Sub_Tag,ssc.Name) as Sub_Tag,
sod.SkuQuantity * sco.conversiontokgs as OrderKgs,
sod.billedquantity * sco.conversiontokgs as BilledKgs,
sod.fulfilledquantity * sco.conversiontokgs as FulfilledKgs
from
SaleOrder so
left join SaleOrderDetails sod on sod.SaleOrderId = so.id
left join SaleOrderAdditionalInfo soa on soa.SaleOrderId=so.id
left join Weight w on sod.LotWeightId=w.id
left join Customer c on c.id = so.CustomerId
left join CustomerAttribute ca on ca.CustomerId = c.id and ca.Deleted = 0
left join Sku s on sod.SkuId = s.id
join BusinessPartner bp on bp.id = ca.BusinessPartnerId
left join City ci on ci.id = so.CityId
left join Facility f on so.FacilityId=f.id
left join SkuSubCategory ssc on ssc.id=s.subcategoryid
left join
(
select pei.externalProductName ,pei.fsnCode ,pei.externalProductId ,externalProductUnit ,pei.hsnCode,pei.skuid,pei.lotWeightId,pei.subResellerId,cityid, pei.externalOutletId, pei.Identifier
from
vormir.ProductExternalInternalMapping pei
left join City c on c.id=pei.cityid
where c.id=2
)pei on so.CityId=pei.CityId and sod.SkuId=pei.skuid and sod.lotWeightId=pei.lotWeightId and pei.externalOutletId = so.CustomerId
left join SkuConfiguration sco on sco.skuid=s.id
left join datalake.FK_Sku_Tag tag on tag.Cityid=ci.id and tag.FSN=pei.fsnCode and so.deliverydate between tag.fromdate and tag.todate
left join datalake.FK_XD_Tag xd on xd.subcat=ssc.Name
left join CustomerDeliverySlot cds on cds.id=soa.deliveryslotid
where so.DeliveryDate between '{{from date}}' and '{{to date}}'
and ca.InvoiceType=0
and (ifnull(bp.partnertype, 'B2B') = 'B2C' or bp.id=106)  and so.Type in (1,2,7,9)
and f.id in (9382)
and ((sod.deleted = 0) or (sod.Deleted = 1 and sod.SkuQuantity != sod.BilledQuantity))
and so.Deleted=0
and so.status=5
group by so.DeliveryDate,sod.SKuid,so.FacilityId,so.CustomerId,sod.LotWeightId,so.id
)base
group by DeliveryDate,
CityId,
weightunit,
FSN
)base1 on base.DeliveryDate+interval 1 day=base1.deliverydate and base.weightunit=base1.weightunit
